// Text editing: whole lines are rewritten. The old letters are deleted from the page code with the redaction engine
// (without a bar, links stay), the new text is written with Liberation Sans (or a standard PDF font for serif/mono).
// Unchanged parts of a line keep their look (bold, italic, color); the changed part takes the look of the text it replaces.
// Pages are never turned into images. Two checks: no old letter remains under the line, and no other letter was lost.
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, degrees } from '../media/lib/pdf-lib.esm.min.js';
import { openPdf, pageChars, renderPage } from './pdftext.mjs';
import { applyRedactions, checkVectorPages, openJs } from './vredact.mjs';
import { FONT_FILE } from './textlayer.mjs';

const SCALE = 2.5;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * Groups the characters of a page into lines (pixels at SCALE, top left).
 * text and src run in parallel: src[k] is the character index (in pc.chars) behind text[k].
 */
export function linesOf(pc) {
  const lines = []; let cur = null;
  const close = () => {
    if (cur && cur.idx.length) {
      while (cur.t.length && cur.t[cur.t.length - 1] === ' ') { cur.t.pop(); cur.src.pop(); }
      lines.push({ text: cur.t.join(''), src: cur.src, idx: cur.idx, x0: cur.x0, x1: cur.x1, base: cur.base, sizePx: cur.sizePx, size: cur.sizePx / SCALE });
    }
    cur = null;
  };
  pc.chars.forEach((c, i) => {
    const space = /\s/.test(c.ch);
    if (c.gen || !c.rect || !c.origin) {
      if (/[\r\n]/.test(c.ch)) close();
      else if (cur && space && cur.t[cur.t.length - 1] !== ' ') { cur.t.push(' '); cur.src.push(cur.idx[cur.idx.length - 1]); }
      return;
    }
    const h = c.rect[3] - c.rect[1], fsPx = c.fontSize > 1.5 ? c.fontSize * SCALE : h / 0.7;
    if (cur) {
      const same = Math.abs(c.origin[1] - cur.base) <= 0.35 * cur.sizePx && c.rect[0] >= cur.x1 - cur.sizePx && c.rect[0] - cur.x1 < 3 * cur.sizePx;
      if (!same) close();
    }
    if (!cur) { if (space) return; cur = { t: [], src: [], idx: [], x0: c.rect[0], x1: c.rect[2], base: c.origin[1], sizes: [], sizePx: fsPx }; }
    if (space) { if (cur.t[cur.t.length - 1] !== ' ') { cur.t.push(' '); cur.src.push(i); } }
    else { for (const ch of c.ch) { cur.t.push(ch); cur.src.push(i); } cur.sizes.push(fsPx); cur.sizePx = median(cur.sizes); }
    cur.idx.push(i); cur.x0 = Math.min(cur.x0, c.rect[0]); cur.x1 = Math.max(cur.x1, c.rect[2]);
  });
  close();
  return lines;
}

/** Look of characters from the PDF: bold, italic, font family (sans/serif/mono) and fill color. Returns Map(index -> style). */
export function charStyles(lib, page, idxs) {
  const out = new Map(), m = lib.module, tp = m._FPDFText_LoadPage(page.pageIdx); if (!tp) return out;
  const buf = m.wasmExports.malloc(256);
  try {
    for (const idx of idxs) {
      if (out.has(idx)) continue;
      const weight = m._FPDFText_GetFontWeight(tp, idx);
      const n = m._FPDFText_GetFontInfo(tp, idx, buf + 32, 200, buf);
      const flags = new Int32Array(m.HEAPU8.buffer, buf, 1)[0];
      const name = n > 1 ? new TextDecoder().decode(m.HEAPU8.subarray(buf + 32, buf + 32 + Math.min(n, 200) - 1)) : '';
      let color = null;
      if (m._FPDFText_GetFillColor(tp, idx, buf + 4, buf + 8, buf + 12, buf + 16)) color = '#' + [...new Uint32Array(m.HEAPU8.buffer, buf + 4, 3)].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
      const mono = (flags & 1) || /mono|courier|consol/i.test(name), serif = !/sans/i.test(name) && ((flags & 2) || /times|serif|roman|georgia|garamond|cambria|minion/i.test(name));
      out.set(idx, { bold: weight >= 600 || /bold|black|heavy|semibold|demi/i.test(name), italic: !!(flags & 64) || /italic|oblique/i.test(name), font: mono ? 'mono' : serif ? 'serif' : 'sans', color });
    }
  } finally { m.wasmExports.free(buf); m._FPDFText_ClosePage(tp); }
  return out;
}

// The area whose letters are deleted: the line between cap height and a little below the baseline.
// Kept narrow so that letters of the lines above and below are never touched (checked again afterwards).
const barOf = (l) => [l.x0 - 1, l.base - 0.75 * l.sizePx, l.x1 + 1, l.base + 0.12 * l.sizePx];
const inBar = (r, b) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; };

// What the eye sees is not always the text: scans (image) or OCR'd PDFs with outlined letters (vector shapes) carry
// an invisible text layer. After deleting the letters, the rendered page shows whether ink is still left where the line was.
// If so, that area is covered in the colour around it (median of a ring just outside).
// Generous enough for ascenders and descenders, but never into the neighbouring lines (all = every line of the page)
function coverOf(l, all) {
  let top = l.base - 1.0 * l.sizePx, bot = l.base + 0.45 * l.sizePx;
  for (const o of all) {
    if (o.x1 < l.x0 || o.x0 > l.x1 || Math.abs(o.base - l.base) < 0.3 * l.sizePx) continue;
    if (o.base < l.base) top = Math.max(top, o.base + 0.3 * o.sizePx); else bot = Math.min(bot, o.base - 0.8 * o.sizePx);
  }
  return [l.x0 - 0.15 * l.sizePx, top, l.x1 + 0.15 * l.sizePx, Math.max(bot, l.base + 0.15 * l.sizePx)];
}
function leftoverInk(img, r) {
  const { rgba, width: W, height: H } = img, at = (x, y) => (y * W + x) * 4;
  const x0 = Math.max(0, Math.floor(r[0])), y0 = Math.max(0, Math.floor(r[1])), x1 = Math.min(W - 1, Math.ceil(r[2])), y1 = Math.min(H - 1, Math.ceil(r[3]));
  if (x1 <= x0 || y1 <= y0) return null;
  const ring = [];
  for (let x = x0; x <= x1; x += 2) { if (y0 >= 2) ring.push(at(x, y0 - 2)); if (y1 + 2 < H) ring.push(at(x, y1 + 2)); }
  for (let y = y0; y <= y1; y += 2) { if (x0 >= 2) ring.push(at(x0 - 2, y)); if (x1 + 2 < W) ring.push(at(x1 + 2, y)); }
  const bg = [0, 1, 2].map((c) => median(ring.map((o) => rgba[o + c])));
  let ink = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = at(x, y); if (Math.abs(rgba[o] - bg[0]) + Math.abs(rgba[o + 1] - bg[1]) + Math.abs(rgba[o + 2] - bg[2]) > 120) ink++; }
  return ink / ((x1 - x0 + 1) * (y1 - y0 + 1)) > 0.01 ? rgb(bg[0] / 255, bg[1] / 255, bg[2] / 255) : null;
}

const WIN_ANSI = /^[\n\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
const SANS = { '': 'Regular', B: 'Bold', I: 'Italic', BI: 'BoldItalic' };
const STD = { serif: { '': 'TimesRoman', B: 'TimesRomanBold', I: 'TimesRomanItalic', BI: 'TimesRomanBoldItalic' }, mono: { '': 'Courier', B: 'CourierBold', I: 'CourierOblique', BI: 'CourierBoldOblique' } };
async function fontFor(doc, cache, st, text) {
  const v = (st.bold ? 'B' : '') + (st.italic ? 'I' : '');
  const key = STD[st.font] && WIN_ANSI.test(text) ? STD[st.font][v] : 'sans' + v;
  if (!cache[key]) cache[key] = key.startsWith('sans') ? await doc.embedFont(fs.readFileSync(FONT_FILE.replace('Regular', SANS[v])), { subset: true }) : await doc.embedFont(StandardFonts[key]);
  return cache[key];
}
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0; return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const styleKey = (s) => [s.font, s.bold, s.italic, s.color].join('|');
// Consecutive characters with the same look form a run
function runsOf(text, styles) {
  const runs = [];
  for (let k = 0; k < text.length; k++) {
    const last = runs[runs.length - 1];
    if (last && styleKey(last.st) === styleKey(styles[k])) last.text += text[k]; else runs.push({ text: text[k], st: styles[k] });
  }
  return runs;
}

/**
 * Core: replaces resolved lines. items: [{ page (0-based), lines: [from linesOf], text, size?, style? (overrides the look for the whole text) }]
 * Returns { bytes, changed: [{ page, old, new }], covered: [page numbers where the old line was still visible and is covered] }.
 */
async function applyLineEdits(bytes, pdf, items) {
  const plan = new Map(), keep = new Map();
  for (const it of items) {
    const bars = plan.get(it.page) || plan.set(it.page, []).get(it.page);
    it.lines.forEach((l) => bars.push(barOf(l)));
    // Look of every old character (the line break between two lines takes the look of the next line)
    const src = it.lines.flatMap((l, k) => (k ? [l.src[0], ...l.src] : l.src));
    const map = charStyles(pdf.lib, pdf.doc.getPage(it.page), src), def = { font: 'sans', bold: false, italic: false, color: null };
    it.oldStyles = src.map((i) => ({ ...def, ...(map.get(i) || {}), ...(it.style || {}) }));
  }
  // Letters outside the areas that must survive (per page)
  for (const [i, bars] of plan) {
    const pc = pageChars(pdf.lib, pdf.doc.getPage(i), SCALE);
    keep.set(i, pc.chars.filter((c) => !c.gen && c.rect && !bars.some((b) => inBar(c.rect, b))).length);
  }
  let res;
  try { res = await applyRedactions({ bytes, pdfium: pdf, plan, scale: SCALE, edit: true }); }
  catch (e) { throw new Error(`Page ${e.page || '?'} cannot be edited (${e.message}).`); }

  const chk = await openPdf(res.bytes);
  try {
    const bad = checkVectorPages(chk, plan, res.modes, SCALE);
    if (bad.size) throw new Error(`The old text on page ${[...bad].map((i) => i + 1).join(', ')} could not be removed completely. Nothing was changed.`);
    for (const [i, n] of keep) {
      const after = pageChars(chk.lib, chk.doc.getPage(i), SCALE).chars.filter((c) => !c.gen && c.rect).length;
      if (after !== n) throw new Error(`Editing page ${i + 1} would also remove other text. Nothing was changed.`);
    }
    const imgs = new Map();
    for (const it of items) {
      if (!imgs.has(it.page)) imgs.set(it.page, { img: await renderPage(chk.doc.getPage(it.page), SCALE), all: linesOf(pageChars(pdf.lib, pdf.doc.getPage(it.page), SCALE)) });
      const { img, all } = imgs.get(it.page);
      it.covers = it.lines.map((l) => { const r = coverOf(l, all); return { r, color: leftoverInk(img, r) }; }).filter((c) => c.color);
    }
  } finally { chk.close(); }

  const doc = await PDFDocument.load(res.bytes, { ignoreEncryption: true, updateMetadata: false });
  doc.registerFontkit(fontkit);
  const js = await openJs(res.bytes), fonts = {}, changed = [], covered = new Set();
  const widthOf = async (runs, size) => { let w = 0; for (const r of runs) w += (await fontFor(doc, fonts, r.st, r.text)).widthOfTextAtSize(r.text, size); return w; };
  try {
    for (const it of items) {
      const pg = doc.getPage(it.page), vp = (await js.getPage(it.page + 1)).getViewport({ scale: 1 });
      const P = (x, y) => vp.convertToPdfPoint(x / SCALE, y / SCALE);
      const first = it.lines[0], o = P(first.x0, first.base), e = P(first.x0 + 100, first.base);
      const angle = Math.round(Math.atan2(e[1] - o[1], e[0] - o[0]) * 180 / Math.PI);
      const oldText = it.lines.map((l) => l.text).join('\n'), text = String(it.text ?? '').replace(/\r/g, '');
      // Unchanged start and end keep their look; the changed middle takes the look of the first replaced character
      let p = 0; while (p < oldText.length && p < text.length && oldText[p] === text[p]) p++;
      let s = 0; while (s < oldText.length - p && s < text.length - p && oldText[oldText.length - 1 - s] === text[text.length - 1 - s]) s++;
      const os = it.oldStyles, mid = os[Math.min(p, os.length - 1)] || os[0];
      const styles = [...text].map((_, j) => (j < p ? os[j] : j >= text.length - s ? os[oldText.length - (text.length - j)] : mid));
      // The replacement font is usually wider than the original (e.g. Calibri): shrink the size so the old line would keep its width
      let size = +it.size > 0 ? +it.size : first.size;
      if (!(+it.size > 0) && first.text) { const wOld = await widthOf(runsOf(first.text, os.slice(0, first.text.length)), size), w0 = (first.x1 - first.x0) / SCALE; if (wOld > 0 && w0 / wOld < 1) size *= Math.max(0.6, w0 / wOld); }
      const lead = it.lines.length > 1 ? (it.lines[it.lines.length - 1].base - first.base) / (it.lines.length - 1) / SCALE : first.size * 1.2;
      for (const { r: b, color } of it.covers) { // the old line is still visible (scan or outlined letters): cover it
        const pts = [P(b[0], b[1]), P(b[2], b[3])];
        pg.drawRectangle({ x: Math.min(pts[0][0], pts[1][0]), y: Math.min(pts[0][1], pts[1][1]), width: Math.abs(pts[0][0] - pts[1][0]), height: Math.abs(pts[0][1] - pts[1][1]), color });
        covered.add(it.page + 1);
      }
      let j = 0;
      for (const [k, line] of text.split('\n').entries()) {
        let adv = 0;
        for (const r of runsOf(line, styles.slice(j, j + line.length))) {
          const font = await fontFor(doc, fonts, r.st, r.text), pt = P(first.x0 + adv * SCALE, first.base + k * lead * SCALE);
          pg.drawText(r.text, { x: pt[0], y: pt[1], size, font, color: hexRgb(r.st.color), rotate: degrees(angle) });
          adv += font.widthOfTextAtSize(r.text, size);
        }
        j += line.length + 1;
      }
      changed.push({ page: it.page + 1, old: oldText, new: text });
    }
  } finally { await js.destroy(); }
  return { bytes: await doc.save({ useObjectStreams: true }), changed, covered: [...covered] };
}

/** Lines whose middle lies inside the box (pixels at SCALE). */
function linesInBox(pdf, i, box) {
  let pc; try { pc = pageChars(pdf.lib, pdf.doc.getPage(i), SCALE); } catch { return []; }
  return linesOf(pc).filter((l) => { const cx = (l.x0 + l.x1) / 2, cy = l.base - 0.35 * l.sizePx; return cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]; }).sort((a, b) => a.base - b.base);
}

/**
 * Edits from the viewer: edits = [{ page (1-based), x, y, w, h (0..1 of the displayed page, top left), text, size?, style? }].
 * The box marks the line(s) to replace; the engine finds the exact lines itself. style ({ bold, italic, font, color }) is optional.
 */
export async function editText(bytes, edits) {
  const pdf = await openPdf(bytes);
  try {
    const items = [];
    for (const e of edits || []) {
      const i = (e.page | 0) - 1; if (i < 0 || i >= pdf.count) throw new Error(`Page ${e.page} does not exist.`);
      const sz = pdf.doc.getPage(i).getSize({ scale: SCALE });
      const lines = linesInBox(pdf, i, [e.x * sz.width, e.y * sz.height, (e.x + e.w) * sz.width, (e.y + e.h) * sz.height]);
      if (!lines.length) throw new Error(`No text line found at this position on page ${e.page}. Scanned pages need text recognition (OCR) first.`);
      items.push({ page: i, lines, text: e.text, size: e.size, style: e.style && Object.fromEntries(Object.entries(e.style).filter(([, v]) => v != null)) });
    }
    if (!items.length) return { bytes: null, changed: [] };
    return await applyLineEdits(bytes, pdf, items);
  } finally { pdf.close(); }
}

/** Reads the lines in a box (for the viewer: exact text and look before editing). */
export async function readLines(bytes, { page, x, y, w, h }) {
  const pdf = await openPdf(bytes);
  try {
    const i = (page | 0) - 1, sz = pdf.doc.getPage(i).getSize({ scale: SCALE });
    const lines = linesInBox(pdf, i, [x * sz.width, y * sz.height, (x + w) * sz.width, (y + h) * sz.height]);
    if (!lines.length) return null;
    const st = charStyles(pdf.lib, pdf.doc.getPage(i), [lines[0].idx[0]]).get(lines[0].idx[0]) || {};
    const a = lines[0], z = lines[lines.length - 1];
    return { text: lines.map((l) => l.text).join('\n'), size: a.size, style: st, box: { x: (Math.min(...lines.map((l) => l.x0)) - 1) / sz.width, y: (a.base - 0.95 * a.sizePx) / sz.height, w: (Math.max(...lines.map((l) => l.x1)) - Math.min(...lines.map((l) => l.x0)) + 2) / sz.width, h: (z.base + 0.3 * z.sizePx - (a.base - 0.95 * a.sizePx)) / sz.height } };
  } finally { pdf.close(); }
}

/** For the AI: replaces text in every line that contains a match. find is plain text unless regex = true. */
export async function replaceText(bytes, { find, replace = '', regex = false, matchCase = false, pages } = {}) {
  if (!find) throw new Error('Missing "find".');
  const re = new RegExp(regex ? find : String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  const pdf = await openPdf(bytes);
  try {
    const items = [];
    for (let i = 0; i < pdf.count; i++) {
      if (pages && !pages.includes(i)) continue;
      let pc; try { pc = pageChars(pdf.lib, pdf.doc.getPage(i), SCALE); } catch { continue; }
      for (const l of linesOf(pc)) {
        re.lastIndex = 0; if (!re.test(l.text)) continue;
        re.lastIndex = 0; items.push({ page: i, lines: [l], text: l.text.replace(re, replace) });
      }
    }
    if (!items.length) return { bytes: null, changed: [] };
    return await applyLineEdits(bytes, pdf, items);
  } finally { pdf.close(); }
}
