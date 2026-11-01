// Writing the annotations into a PDF copy. Two ways:
//  burn:   everything becomes fixed page content (looks the same in every program, no longer editable)
//  annots: highlights, comments, drawings and shapes become real PDF annotations (Acrobat, Edge, Preview … can edit them);
//          text boxes, images and signatures are burned in (they must look exactly as placed).
// Pure on bytes and the annotation data, no DOM: the shapes are shared with the viewer.
import { PDFDocument, PDFName, PDFString, PDFHexString, rgb, StandardFonts, BlendMode, LineCapStyle, degrees } from './lib/pdf-lib.esm.min.js';
import { toPdf } from './pdfops.js';

/**
 * Polylines (normalized 0..1 points) of a drawing: free hand, line, arrow, rectangle, ellipse.
 * aspect = page width / height, so that arrow heads and ellipses are not distorted.
 */
export function shapePolys(s, aspect = 1) {
  const p = s.pts || [];
  if (!s.shape || s.shape === 'free' || s.shape === 'marker' || p.length < 2) return [p];
  const [a, b] = [p[0], p[p.length - 1]];
  if (s.shape === 'line') return [[a, b]];
  if (s.shape === 'rect') return [[a, [b[0], a[1]], b, [a[0], b[1]], a]];
  if (s.shape === 'ellipse') {
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
    return [Array.from({ length: 65 }, (_, i) => { const t = (i / 64) * 2 * Math.PI; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; })];
  }
  if (s.shape === 'arrow') {
    const dx = (b[0] - a[0]) * aspect, dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-6, L = Math.min(0.04, Math.max(0.012, len * 0.22)) + (s.w || 3) * 0.0015;
    const head = (sg) => { const c = Math.cos(sg), si = Math.sin(sg), ux = dx / len, uy = dy / len, rx = ux * c - uy * si, ry = ux * si + uy * c; return [b[0] - (rx * L) / aspect, b[1] - ry * L]; };
    return [[a, b], [head(0.5), b, head(-0.5)]];
  }
  return [p];
}

const hexRgb = (h) => { const n = parseInt(String(h || '#000000').slice(1), 16) || 0; return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const hex3 = (h) => { const n = parseInt(String(h || '#000000').slice(1), 16) || 0; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const winAnsi = (s) => String(s).replace(/[^\n\x20-\x7E\xA0-\xFF€‚„…–—‘’“”•]/g, '?');
const pdfDate = (d = new Date()) => 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
const dataBytes = (url) => Uint8Array.from(atob(String(url).split(',')[1] || ''), (c) => c.charCodeAt(0));

/**
 * bytes: PDF, ann: { page: { hl, ink, notes, sigs, texts, imgs } }, mode: 'burn' | 'annots', author: name for real annotations.
 * Returns the new PDF bytes.
 */
export async function buildPdf(bytes, ann, { mode = 'burn', author = 'PDF Workbench' } = {}) {
  const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }, pages = doc.getPages();
  for (const [key, a] of Object.entries(ann || {})) {
    const pg = pages[+key - 1]; if (!pg) continue;
    const { width: W, height: H } = pg.getSize(), r = ((pg.getRotation().angle % 360) + 360) % 360, dw = r % 180 ? H : W, dh = r % 180 ? W : H;
    const P = (u, v) => toPdf(u, v, W, H, r);                       // normalized (display) -> PDF
    const D = (x, y) => P(x / dw, y / dh);                          // display point (pt, from top left) -> PDF
    const real = mode === 'annots', annots = [];
    const add = (dict) => annots.push(doc.context.register(doc.context.obj({ Type: 'Annot', F: 4, T: PDFHexString.fromText(author), M: PDFString.of(pdfDate()), ...dict })));
    const bbox = (pts, pad = 0) => { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]; };

    // Highlights, underlines, strike-throughs
    for (const h of a.hl || []) {
      const style = h.style || 'hl';
      if (real) {
        const quads = [], all = [];
        h.rects.forEach(([x, y, w, hh]) => { const ul = P(x, y), ur = P(x + w, y), ll = P(x, y + hh), lr = P(x + w, y + hh); quads.push(...ul, ...ur, ...ll, ...lr); all.push(ul, ur, ll, lr); });
        add({ Subtype: style === 'ul' ? 'Underline' : style === 'st' ? 'StrikeOut' : 'Highlight', Rect: bbox(all), QuadPoints: quads, C: hex3(h.color), CA: 1, Contents: PDFHexString.fromText(h.note || (h.text !== '…' ? h.text || '' : '')) });
        continue;
      }
      h.rects.forEach(([x, y, w, hh]) => {
        if (style === 'hl') { const p1 = P(x, y), p2 = P(x + w, y + hh); pg.drawRectangle({ x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), width: Math.abs(p1[0] - p2[0]), height: Math.abs(p1[1] - p2[1]), color: hexRgb(h.color), blendMode: BlendMode.Multiply }); return; }
        const yy = y + hh * (style === 'ul' ? 0.93 : 0.55), s = P(x, yy), e = P(x + w, yy);
        pg.drawLine({ start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, thickness: Math.max(0.7, hh * dh * 0.075), color: hexRgb(h.color) });
      });
    }

    // Drawings and shapes
    for (const s of a.ink || []) {
      const marker = s.shape === 'marker', op = marker ? 0.4 : 1, width = s.w * 0.75 * (marker ? 4 : 1);
      if (real) {
        const pts = (s.pts || []).map((q) => P(...q));
        const base = { C: hex3(s.color), CA: op, BS: { W: width, S: 'S' }, Contents: PDFHexString.fromText('') };
        if (s.shape === 'line' || s.shape === 'arrow') { const L = [...pts[0], ...pts[pts.length - 1]]; add({ ...base, Subtype: 'Line', L, LE: [PDFName.of('None'), PDFName.of(s.shape === 'arrow' ? 'OpenArrow' : 'None')], Rect: bbox([pts[0], pts[pts.length - 1]], width + 6) }); }
        else if (s.shape === 'rect' || s.shape === 'ellipse') add({ ...base, Subtype: s.shape === 'rect' ? 'Square' : 'Circle', Rect: bbox([pts[0], pts[pts.length - 1]], width / 2) });
        else add({ ...base, Subtype: 'Ink', InkList: [pts.flat()], Rect: bbox(pts, width) });
        continue;
      }
      for (const poly of shapePolys(s, dw / dh)) for (let i = 1; i < poly.length; i++) {
        const p = P(...poly[i - 1]), q = P(...poly[i]);
        pg.drawLine({ start: { x: p[0], y: p[1] }, end: { x: q[0], y: q[1] }, thickness: width, color: hexRgb(s.color), lineCap: LineCapStyle.Round, opacity: op, blendMode: marker ? BlendMode.Multiply : undefined });
      }
    }

    // Comments (sticky notes)
    for (const nt of a.notes || []) {
      if (real) { const c = D(nt.x * dw, nt.y * dh); add({ Subtype: 'Text', Name: 'Comment', Open: false, Rect: [c[0], c[1] - 20, c[0] + 20, c[1]], C: [1, 0.85, 0.2], Contents: PDFHexString.fromText(nt.text || '') }); continue; }
      const font = fonts.reg, x = nt.x * dw, y = nt.y * dh, size = 8, maxW = 150, words = winAnsi(nt.text).split(/\s+/), lines = []; let line = '';
      words.forEach((w) => { const tt = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(tt, size) > maxW && line) { lines.push(line); line = w; } else line = tt; }); if (line) lines.push(line);
      const bh = lines.length * (size + 2) + 6, bx = Math.min(x + 6, dw - maxW - 10), by = Math.min(dh - 4, y + bh);
      const o = D(bx, by); pg.drawRectangle({ x: o[0], y: o[1], width: maxW + 8, height: bh, rotate: degrees(r), color: rgb(1, 0.95, 0.55), borderColor: rgb(0.8, 0.65, 0), borderWidth: 0.6 });
      lines.forEach((l, i) => { const q = D(bx + 4, by - bh + 9 + i * (size + 2)); pg.drawText(l, { x: q[0], y: q[1], size, font, rotate: degrees(r), color: rgb(0.1, 0.1, 0.1) }); });
      const c = D(x, y); pg.drawCircle({ x: c[0], y: c[1], size: 3.5, color: rgb(0.99, 0.84, 0.2), borderColor: rgb(0.6, 0.45, 0), borderWidth: 0.6 });
    }

    // Text boxes (always burned in)
    for (const tx of a.texts || []) {
      const font = tx.bold ? fonts.bold : fonts.reg, size = tx.size || 12;
      winAnsi(tx.text || '').split('\n').forEach((l, i) => { if (!l) return; const q = D(tx.x * dw + 1, tx.y * dh + size * 0.92 + i * size * 1.2); pg.drawText(l, { x: q[0], y: q[1], size, font, rotate: degrees(r), color: hexRgb(tx.color) }); });
    }

    // Images and signatures (always burned in)
    for (const sg of [...(a.imgs || []), ...(a.sigs || [])]) {
      const img = /^data:image\/jpe?g/i.test(sg.img) ? await doc.embedJpg(dataBytes(sg.img)) : await doc.embedPng(sg.img);
      const o = D(sg.x * dw, (sg.y + sg.h) * dh);
      pg.drawImage(img, { x: o[0], y: o[1], width: sg.w * dw, height: sg.h * dh, rotate: degrees(r) });
    }

    if (annots.length) {
      const old = pg.node.lookup(PDFName.of('Annots'));
      if (old && old.push) annots.forEach((x) => old.push(x)); else pg.node.set(PDFName.of('Annots'), doc.context.obj(annots));
    }
  }
  return await doc.save();
}
