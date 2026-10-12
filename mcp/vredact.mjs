// Redaction with preserved structure: the letters under the bars are deleted directly from the page code,
// everything else (fonts, layout, links, bookmarks, forms) stays unchanged.
// Only when that is not safe (image/graphic under the bar, unusual structure) is the page turned, as a fallback,
// into an image with an exact text layer.
import * as pdfjs from '../media/lib/pdf.min.mjs';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFRef, PDFPage, PDFNumber, decodePDFRawStream } from '../media/lib/pdf-lib.esm.min.js';
import { parseContent, hex } from './content.mjs';
import { pageChars, renderPage, blackout, encodePng } from './pdftext.mjs';
import { addTextLayer, overlaps, FONT_FILE } from './textlayer.mjs';

const LIB = fileURLToPath(new URL('../media/lib/', import.meta.url));
pdfjs.GlobalWorkerOptions.workerSrc = 'file://' + encodeURI(LIB.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:') + 'pdf.worker.min.mjs');
const urlOf = (sub) => 'file://' + encodeURI((LIB + sub).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'));

export async function openJs(bytes) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, verbosity: 0, standardFontDataUrl: urlOf('standard_fonts/'), cMapUrl: urlOf('cmaps/'), cMapPacked: true }).promise;
}

// ---------------------------------------------------------------- Geometry
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const bboxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
function inter(a, b) { return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; }
function hitsBars(box, bars, frac = 0.2) {
  const a = area(box), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  return bars.some((b) => (cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]) || (a > 0 && area(inter(box, b)) / a > frac));
}
const fmt = (v) => String(Math.round(v * 10000) / 10000);

// ---------------------------------------------------------------- pdf.js analysis of a page
/** Walks the operator list from pdf.js and returns all text instructions with character positions (user coordinates). */
async function analyze(page, bars) {
  const O = pdfjs.OPS, ol = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  let st = { ctm: [1, 0, 0, 1, 0, 0], tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0], size: 0, Tc: 0, Tw: 0, Th: 1, rise: 0, leading: 0, fm0: 0.001, vertical: false, type3: false };
  const stack = [], textOps = [], images = [], curves = [];
  let pathBox = null, pathCurve = false, groupImages = false;
  const move = (x, y) => { st.tlm = mul([1, 0, 0, 1, x, y], st.tlm); st.tm = st.tlm; };
  const unit = () => bboxOf([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(st.ctm, x, y)));
  const shows = (kind, arr) => {
    const top = { kind, items: [], Tc: st.Tc, Tw: st.Tw, Th: st.Th, size: st.size, fm0: st.fm0, vertical: st.vertical, type3: st.type3 };
    let tx = 0;
    for (const it of arr) {
      if (typeof it === 'number') { top.items.push({ n: it }); tx += (-it / 1000) * st.size * st.Th; continue; }
      if (!it || typeof it !== 'object') continue;
      const w = it.width || 0, adv = w * st.fm0 * st.size, M = mul([1, 0, 0, 1, tx, 0], mul(st.tm, st.ctm));
      const lo = st.rise - 0.25 * st.size, hi = st.rise + 0.95 * st.size, wd = adv * st.Th;
      const box = bboxOf([[0, lo], [wd, lo], [0, hi], [wd, hi]].map(([x, y]) => apply(M, x, y)));
      top.items.push({ g: it, w, code: it.originalCharCode, box });
      tx += (adv + st.Tc + (it.originalCharCode === 32 ? st.Tw : 0)) * st.Th;
    }
    st.tm = mul([1, 0, 0, 1, tx, 0], st.tm);
    textOps.push(top);
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    switch (f) {
      case O.save: stack.push({ ...st }); break;
      case O.restore: if (stack.length) st = stack.pop(); break;
      case O.transform: st.ctm = mul(a, st.ctm); break;
      case O.paintFormXObjectBegin: stack.push({ ...st }); if (a && a[0]) st.ctm = mul(a[0], st.ctm); break;
      case O.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
      case O.beginText: st.tm = [1, 0, 0, 1, 0, 0]; st.tlm = [1, 0, 0, 1, 0, 0]; break;
      case O.setCharSpacing: st.Tc = a[0]; break;
      case O.setWordSpacing: st.Tw = a[0]; break;
      case O.setHScale: st.Th = a[0] / 100; break;
      case O.setLeading: st.leading = a[0]; break;
      case O.setTextRise: st.rise = a[0]; break;
      case O.setFont: {
        st.size = a[1]; st.fm0 = 0.001; st.vertical = false; st.type3 = false;
        try { const fo = page.commonObjs.get(a[0]); if (fo.fontMatrix) st.fm0 = fo.fontMatrix[0]; st.vertical = !!fo.vertical; st.type3 = !!fo.isType3Font; } catch { /* Standardwerte */ }
        break;
      }
      case O.moveText: move(a[0], a[1]); break;
      case O.setLeadingMoveText: st.leading = -a[1]; move(a[0], a[1]); break;
      case O.setTextMatrix: st.tm = a.slice(0, 6); st.tlm = a.slice(0, 6); break;
      case O.nextLine: move(0, -st.leading); break;
      case O.showText: shows('Tj', a[0]); break;
      case O.showSpacedText: shows('TJ', a[0]); break;
      case O.nextLineShowText: move(0, -st.leading); shows("'", a[0]); break;
      case O.nextLineSetSpacingShowText: st.Tw = a[0]; st.Tc = a[1]; move(0, -st.leading); shows('"', a[2]); break;
      case O.paintImageXObject: case O.paintInlineImageXObject: case O.paintImageMaskXObject: case O.paintSolidColorImageMask: images.push(unit()); break;
      case O.paintImageXObjectRepeat: case O.paintImageMaskXObjectGroup: case O.paintInlineImageXObjectGroup: groupImages = true; images.push(unit()); break;
      case O.constructPath: {
        // pdf.js 4.x: [ops[], coordinates[], [minX, minY, maxX, maxY]]
        const mm = a[2]; if (mm && mm.length === 4) { const b = bboxOf([[mm[0], mm[1]], [mm[2], mm[1]], [mm[0], mm[3]], [mm[2], mm[3]]].map(([x, y]) => apply(st.ctm, x, y))); pathBox = pathBox ? [Math.min(pathBox[0], b[0]), Math.min(pathBox[1], b[1]), Math.max(pathBox[2], b[2]), Math.max(pathBox[3], b[3])] : b; }
        if (Array.isArray(a[0]) && a[0].some((o) => o === O.curveTo || o === O.curveTo2 || o === O.curveTo3)) pathCurve = true;
        break;
      }
      case O.fill: case O.eoFill: case O.fillStroke: case O.eoFillStroke: case O.closeFillStroke: case O.closeEOFillStroke: case O.stroke: case O.closeStroke:
        if (pathBox && pathCurve) curves.push(pathBox); pathBox = null; pathCurve = false; break;
      case O.endPath: pathBox = null; pathCurve = false; break;
      default: break;
    }
  }
  return { textOps, images, curves, groupImages };
}

// ---------------------------------------------------------------- Rewriting a content stream
function codesOf(strTok, bpc) { const out = []; for (let k = 0; k + bpc <= strTok.v.length; k += bpc) { let c = 0; for (let j = 0; j < bpc; j++) c = c * 256 + strTok.v[k + j]; out.push({ code: c, bytes: strTok.v.subarray(k, k + bpc) }); } return out; }

function rewriteShow(stmt, t) {
  const raw = stmt.op === 'TJ' ? stmt.operands[0]?.v : [stmt.operands[stmt.operands.length - 1]];
  if (!Array.isArray(raw)) throw new Error('Textanweisung unlesbar');
  const glyphs = t.items.filter((x) => x.g);
  const strs = raw.filter((x) => x.t === 'str');
  const total = strs.reduce((s, x) => s + x.v.length, 0);
  if (!glyphs.length || total % glyphs.length) throw new Error('Character count does not match');
  const bpc = total / glyphs.length;
  if (bpc !== 1 && bpc !== 2) throw new Error('Character codes of varying length');
  if (t.vertical) throw new Error('Vertical writing');
  if (!t.size) throw new Error('Font size 0');
  const parts = []; let cur = [], num = 0, gi = 0;
  const flushStr = () => { if (cur.length) { parts.push(hex(Uint8Array.from(cur))); cur = []; } };
  const flushNum = () => { if (num !== 0) { parts.push(fmt(num)); num = 0; } };
  for (const r of raw) {
    if (r.t === 'num') { flushStr(); num += r.v; continue; }
    if (r.t !== 'str') continue;
    for (const c of codesOf(r, bpc)) {
      const g = glyphs[gi++];
      if (!g || g.code !== c.code) throw new Error('Characters do not match');
      if (g.removed) { flushStr(); num += -(g.w * t.fm0 * 1000 + ((t.Tc + (bpc === 1 && c.code === 32 ? t.Tw : 0)) * 1000) / t.size); }
      else { flushNum(); cur.push(...c.bytes); }
    }
  }
  flushStr(); flushNum();
  const arr = `[${parts.join(' ')}] TJ`;
  if (stmt.op === "'") return `T*\n${arr}`;
  if (stmt.op === '"') return `${fmt(stmt.operands[0].v)} Tw ${fmt(stmt.operands[1].v)} Tc\nT*\n${arr}`;
  return arr;
}

const KIND = { Tj: 'Tj', TJ: 'Tj', "'": "'", '"': '"' }; // pdf.js reports both Tj and TJ as showText

/** Walks the content (and forms inside it); rewrites text instructions with the characters deleted. */
function processStream(bytes, resources, ctx, depth = 0) {
  if (depth > 8) throw new Error('Formulare zu tief verschachtelt');
  const stmts = parseContent(bytes), chunks = []; let pos = 0, changed = false;
  for (const s of stmts) {
    if (KIND[s.op]) {
      const t = ctx.textOps[ctx.k++];
      if (!t || t.kind !== KIND[s.op]) throw new Error(`Text instructions do not match the display (no. ${ctx.k}, file: ${s.op}, pdf.js: ${t ? t.kind : 'none'})`);
      if (t.items.some((x) => x.removed || (x.g && x.g.removed))) {
        const rep = rewriteShow(s, t);
        chunks.push(bytes.subarray(pos, s.start), Buffer.from(rep, 'latin1')); pos = s.end; changed = true; ctx.removedGlyphs += t.items.filter((x) => x.g && x.g.removed).length;
      }
    } else if (s.op === 'Do' && s.operands[0]?.t === 'name') {
      const xo = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      const ref = xo?.get(PDFName.of(s.operands[0].v)), stream = ref && ctx.doc.context.lookup(ref);
      if (stream instanceof PDFRawStream && stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) {
        const fres = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || resources;
        const before = ctx.removedGlyphs;
        const nb = processStream(decodePDFRawStream(stream).decode(), fres, ctx, depth + 1);
        if (nb.changed || ctx.removedGlyphs !== before) throw new Error('Redacted text lies in a form object');
      }
    }
  }
  if (!changed) return { bytes, changed: false };
  chunks.push(bytes.subarray(pos));
  return { bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))), changed: true };
}

// ---------------------------------------------------------------- Page level
function contentStreams(doc, node) {
  const c = node.get(PDFName.of('Contents')); const base = doc.context.lookup(c), refs = [];
  if (base instanceof PDFArray) base.asArray().forEach((r) => refs.push(r)); else if (c) refs.push(c);
  return refs.filter((r) => r instanceof PDFRef).map((r) => ({ ref: r, stream: doc.context.lookup(r) }));
}

function cleanPageExtras(doc, node) {
  for (const k of ['Thumb', 'PieceInfo', 'Metadata']) node.delete(PDFName.of(k));
}

const strOf = (v) => { try { return v.decodeText(); } catch { try { return v.asString(); } catch { return ''; } } };
/** Clears a form field (value, default value, appearance) including parent fields. Returns the removed texts. */
function wipeWidget(doc, d, wiped) {
  for (let cur = d, depth = 0; cur instanceof PDFDict && depth < 8; depth++) {
    for (const k of ['V', 'DV']) { const v = doc.context.lookup(cur.get(PDFName.of(k))); if (v && v.decodeText) { const t = strOf(v); if (t) wiped.push(t); } cur.delete(PDFName.of(k)); }
    if (depth === 0) for (const k of ['AP', 'AS']) cur.delete(PDFName.of(k));
    cur = doc.context.lookup(cur.get(PDFName.of('Parent')));
  }
}

/** Removes annotations (links, comments) lying under a bar; form fields are cleared and remain. */
function stripAnnots(doc, node, barsUser, wiped) {
  const arr = doc.context.lookup(node.get(PDFName.of('Annots')));
  if (!(arr instanceof PDFArray)) return 0;
  const keep = []; let dropped = 0;
  for (const e of arr.asArray()) {
    const d = doc.context.lookup(e);
    const rect = d instanceof PDFDict ? doc.context.lookup(d.get(PDFName.of('Rect'))) : null;
    if (rect instanceof PDFArray && rect.size() === 4) {
      const v = rect.asArray().map((x) => doc.context.lookup(x).asNumber()), r = [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
      if (barsUser.some((b) => overlaps(r, b))) {
        if (d.get(PDFName.of('Subtype')) === PDFName.of('Widget')) { wipeWidget(doc, d, wiped); keep.push(e); continue; }
        dropped++; continue;
      }
    }
    keep.push(e);
  }
  if (dropped) node.set(PDFName.of('Annots'), doc.context.obj(keep));
  return dropped;
}

async function vectorPage({ doc, jsPage, pageIdx, barsUser, wiped }) {
  const page = doc.getPage(pageIdx), node = page.node;
  const an = await analyze(jsPage, barsUser);
  if (an.images.some((b) => barsUser.some((r) => overlaps(b, r)))) throw new Error('Image under the bar');
  if (an.curves.some((b) => barsUser.some((r) => overlaps(b, r)))) throw new Error('Graphic under the bar');
  for (const t of an.textOps) for (const it of t.items) if (it.g) it.g.removed = it.removed = hitsBars(it.box, barsUser);
  const cs = contentStreams(doc, node);
  if (!cs.length) throw new Error('Page without content');
  const joined = Buffer.concat(cs.flatMap(({ stream }, i) => [Buffer.from(i ? '\n' : ''), Buffer.from(decodePDFRawStream(stream).decode())]));
  const ctx = { doc, textOps: an.textOps, k: 0, removedGlyphs: 0 };
  const res = node.Resources();
  const out = processStream(joined, res, ctx);
  if (ctx.k !== an.textOps.length) throw new Error('Nicht alle Textanweisungen zugeordnet');
  const rects = barsUser.map((b) => `${fmt(b[0])} ${fmt(b[1])} ${fmt(b[2] - b[0])} ${fmt(b[3] - b[1])} re`).join('\n');
  const body = Buffer.concat([Buffer.from('q\n'), Buffer.from(out.bytes), Buffer.from(`\nQ\nq\n0 0 0 rg\n${rects}\nf\nQ\n`)]);
  stripAnnots(doc, node, barsUser, wiped);
  const newRef = doc.context.register(doc.context.flateStream(body));
  node.set(PDFName.of('Contents'), newRef);
  for (const { ref } of cs) doc.context.delete(ref);
  cleanPageExtras(doc, node);
  return { removedGlyphs: ctx.removedGlyphs };
}

/** Fallback: page as an image (bars burned in) with an exact invisible text layer, in the same page object. */
async function flattenPage({ doc, pdfium, pageIdx, barsPx, barsUser, scale, fontBox, wiped }) {
  const src = pdfium.doc.getPage(pageIdx);
  const img = await renderPage(src, scale);
  blackout(img, barsPx, 0);
  let pc = null; try { pc = pageChars(pdfium.lib, src, scale); } catch { /* ohne Text */ }
  const page = doc.getPage(pageIdx), node = page.node;
  for (const { ref } of contentStreams(doc, node)) doc.context.delete(ref);
  node.delete(PDFName.of('Contents'));
  node.set(PDFName.of('Resources'), doc.context.obj({}));
  node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, img.ptW, img.ptH]));
  try { stripAnnots(doc, node, barsUser, wiped); } catch { /* weiter */ }
  for (const k of ['CropBox', 'TrimBox', 'BleedBox', 'ArtBox', 'Rotate', 'Annots']) node.delete(PDFName.of(k));
  cleanPageExtras(doc, node);
  const fresh = PDFPage.of(node, page.ref, doc);
  const png = await doc.embedPng(encodePng(img));
  fresh.drawImage(png, { x: 0, y: 0, width: img.ptW, height: img.ptH });
  if (pc) { if (!fontBox.font) { doc.registerFontkit(fontkit); fontBox.font = await doc.embedFont(fs.readFileSync(FONT_FILE), { subset: true }); } addTextLayer(doc, fresh, fontBox.font, pc, barsPx, scale, img.ptH); }
}

/** Deletes all objects nothing refers to any more (pdf-lib otherwise also writes orphaned objects, e.g. old page contents). */
function collectGarbage(doc) {
  const ctx = doc.context, seen = new Set(), stack = [];
  const push = (v) => { if (v instanceof PDFRef) { const k = v.toString(); if (!seen.has(k)) { seen.add(k); stack.push(v); } } else if (v) visit(v); };
  const visit = (o) => {
    if (o instanceof PDFRawStream || (o && o.dict && o.contents !== undefined)) o = o.dict;
    if (o instanceof PDFDict) o.entries().forEach(([, v]) => push(v));
    else if (o instanceof PDFArray) o.asArray().forEach(push);
  };
  const t = ctx.trailerInfo; for (const k of ['Root', 'Info', 'Encrypt']) push(t[k]);
  while (stack.length) { const r = stack.pop(); visit(ctx.lookup(r)); }
  let n = 0;
  for (const [ref] of [...ctx.enumerateIndirectObjects()]) if (!seen.has(ref.toString())) { ctx.delete(ref); n++; }
  return n;
}

/**
 * plan: Map(page index -> bars in pixels at `scale`, top left). pdfium: opened original (openPdf).
 * force: Set of pages that should be rebuilt directly as an image.
 * Returns { bytes, modes: Map(page -> 'vector' | 'image'), reasons: Map(page -> reason) }.
 */
export async function applyRedactions({ bytes, pdfium, plan, scale, force = new Set() }) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const js = await openJs(bytes), modes = new Map(), reasons = new Map(), fontBox = {}, wiped = [];
  try {
    for (const [i, barsPx] of plan) {
      const jsPage = await js.getPage(i + 1), vp = jsPage.getViewport({ scale: 1 });
      const barsUser = barsPx.map(([x0, y0, x1, y1]) => {
        const a = vp.convertToPdfPoint(x0 / scale, y0 / scale), b = vp.convertToPdfPoint(x1 / scale, y1 / scale);
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      });
      let done = false;
      if (!force.has(i)) {
        try { await vectorPage({ doc, jsPage, pageIdx: i, barsUser, wiped }); modes.set(i, 'vector'); done = true; }
        catch (e) { reasons.set(i, String(e.message || e)); }
      } else reasons.set(i, 'Check of the vector variant failed');
      if (!done) { await flattenPage({ doc, pdfium, pageIdx: i, barsPx, barsUser, scale, fontBox, wiped }); modes.set(i, 'image'); }
    }
  } finally { await js.destroy(); }
  const dropped = collectGarbage(doc);
  return { bytes: await doc.save({ useObjectStreams: true }), modes, reasons, wiped, dropped };
}

/** Checks the vector pages: no character whose center lies in a bar may remain readable. Returns faulty pages. */
export function checkVectorPages(pdfiumOut, plan, modes, scale) {
  const bad = new Set();
  for (const [i, bars] of plan) {
    if (modes.get(i) !== 'vector') continue;
    let pc; try { pc = pageChars(pdfiumOut.lib, pdfiumOut.doc.getPage(i), scale); } catch { continue; }
    for (const c of pc.chars) {
      if (!c.rect || !c.ch.trim()) continue;
      const cx = (c.rect[0] + c.rect[2]) / 2, cy = (c.rect[1] + c.rect[3]) / 2;
      if (bars.some((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3])) { bad.add(i); break; }
    }
  }
  return bad;
}
