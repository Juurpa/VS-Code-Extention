// Invisible, exactly positioned text layer for pages that are rebuilt as an image (fallback).
import { beginText, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, PDFOperator, PDFNumber, PDFArray, TextRenderingMode } from '../media/lib/pdf-lib.esm.min.js';
import { fileURLToPath } from 'node:url';

export const FONT_FILE = fileURLToPath(new URL('../media/lib/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
export const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Puts invisible text on the image page: the original text, line by line, every character exactly in place
 *  (positions from the original, no text recognition). Characters touching a black bar are missing.
 *  Runs in reading direction (also on rotated pages). */
const FRAME = {
  0: { u: [1, 0], v: [0, 1] }, 90: { u: [0, -1], v: [1, 0] }, 180: { u: [-1, 0], v: [0, -1] }, 270: { u: [0, 1], v: [-1, 0] }
};
export function addTextLayer(out, page, font, pc, bars, scale, ptH) {
  const set = new Set(font.getCharacterSet());
  const key = page.node.newFontDictionary(font.name, font.ref);
  // characters in page points (y up)
  const items = [];
  for (const c of pc.chars) {
    if (!c.ch || c.ch === '\r') continue;
    if (!c.rect) { items.push({ ch: ' ', gen: true }); continue; }
    if (bars.some((b) => overlaps(c.rect, b))) { items.push({ cut: true, removed: c.ch }); continue; }
    if (!set.has(c.ch.codePointAt(0))) { items.push({ cut: true }); continue; }
    const [x0, y0, x1, y1] = c.rect;
    const X0 = x0 / scale, X1 = x1 / scale, Yb = ptH - y1 / scale, Yt = ptH - y0 / scale;
    if (X1 <= X0 || Yt <= Yb) { items.push({ cut: true }); continue; }
    const og = c.origin || [x0, y1];
    items.push({ ch: c.ch, X0, X1, Yb, Yt, cx: (X0 + X1) / 2, cy: (Yb + Yt) / 2, ox: og[0] / scale, oy: ptH - og[1] / scale, fs: c.fontSize > 0 ? c.fontSize : 0 });
  }
  const along = (R, it) => (R === 0 ? [it.X0, it.X1] : R === 90 ? [-it.Yt, -it.Yb] : R === 180 ? [-it.X1, -it.X0] : [it.Yb, it.Yt]);
  const alongO = (R, it) => (R === 0 ? it.ox : R === 90 ? -it.oy : R === 180 ? -it.ox : it.oy);
  const baseO = (R, it) => (R === 0 ? it.oy : R === 90 ? it.ox : R === 180 ? -it.oy : -it.ox);
  const perp = (R, it) => (R === 0 ? [it.Yb, it.Yt] : R === 90 ? [it.X0, it.X1] : R === 180 ? [-it.Yt, -it.Yb] : [-it.X1, -it.X0]);
  const dirOf = (a, b) => { const dx = b.cx - a.cx, dy = b.cy - a.cy; return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : (dy < 0 ? 90 : 270); };

  const removed = []; let rm = '';
  const runs = []; let cur = null, pendingSpace = false;
  const flush = () => { if (cur && cur.chars.length) runs.push(cur); cur = null; pendingSpace = false; };
  for (const it of items) {
    if (it.cut) { flush(); if (it.removed) rm += it.removed; else if (rm) { removed.push(rm); rm = ''; } continue; }
    if (rm) { removed.push(rm); rm = ''; }
    if (it.gen) { if (cur) pendingSpace = true; continue; }
    if (cur) {
      const last = cur.chars[cur.chars.length - 1];
      if (cur.R === null) cur.R = dirOf(last, it);
      const R = cur.R, [ls, le] = along(R, last), [ns] = along(R, it), [lp0, lp1] = perp(R, last), [np0, np1] = perp(R, it);
      const h = Math.max(lp1 - lp0, np1 - np0), cross = Math.abs((np0 + np1) / 2 - (lp0 + lp1) / 2);
      const gap = ns - le;
      if (cross > 0.6 * h || gap < -0.5 * (le - ls) - 1 || gap > 3 * h) { flush(); } else if (pendingSpace) { cur.chars.push({ ch: ' ', space: true }); pendingSpace = false; }
    }
    if (!cur) cur = { R: null, chars: [] };
    cur.chars.push(it);
  }
  flush(); if (rm) removed.push(rm);

  const opsList = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let written = 0;
  for (const run of runs) {
    const R = run.R ?? 0, { u, v } = FRAME[R], real = run.chars.filter((c) => !c.space);
    const hMax = Math.max(...real.map((c) => { const [p0, p1] = perp(R, c); return p1 - p0; }));
    const fsz = Math.max(...real.map((c) => c.fs || 0));
    const size = Math.max(1, fsz || hMax / 1.15), t = baseO(R, real[0]);
    const s0 = alongO(R, real[0]);
    // width factor: a font (e.g. Liberation Sans) is rarely exactly as wide as the original; otherwise gaps appear between characters
    const lastReal = real[real.length - 1];
    const natural = run.chars.reduce((a, c) => a + font.widthOfTextAtSize(c.ch, size), 0);
    const span = along(R, lastReal)[1] - along(R, real[0])[0];
    let kx = natural > 0 && span > 0 ? span / (natural - (run.chars[run.chars.length - 1].space ? font.widthOfTextAtSize(' ', size) : 0)) : 1;
    if (!(kx > 0.3 && kx < 3) || Math.abs(kx - 1) < 0.06) kx = 1;
    const arr = PDFArray.withContext(out.context);
    let pen = s0;
    run.chars.forEach((c, i) => {
      const want = c.space ? pen : alongO(R, c);
      const adj = ((pen - want) / (size * kx)) * 1000;
      if (i > 0 && Math.abs(adj) > 0.01) arr.push(PDFNumber.of(Math.round(adj * 100) / 100));
      arr.push(font.encodeText(c.ch));
      pen = want + font.widthOfTextAtSize(c.ch, size) * kx; if (!c.space) written++;
    });
    const px = s0 * u[0] + t * v[0], py = s0 * u[1] + t * v[1];
    opsList.push(setFontAndSize(key, size), setTextMatrix(u[0] * kx, u[1] * kx, v[0], v[1], px, py), PDFOperator.of('TJ', [arr]));
  }
  opsList.push(endText());
  page.pushOperators(...opsList);
  return { written, removed };
}

