// Text with exact character positions, rendering and redaction (PDFium as WebAssembly, no native parts).
import { PDFiumLibrary } from '@hyzyla/pdfium';
import zlib from 'node:zlib';

let libP;
export const getLib = () => (libP ||= PDFiumLibrary.init());

/** Opens a PDF. Do not forget close(). */
export async function openPdf(bytes) {
  const lib = await getLib();
  const doc = await lib.loadDocument(bytes);
  return { lib, doc, count: doc.getPageCount(), close: () => doc.destroy() };
}

const f64 = (m, ptr, n) => Array.from({ length: n }, (_, i) => m.HEAPF64[(ptr >> 3) + i]);

/** Characters of a page with rectangles in image pixels at `scale` (1 = 72 dpi, origin top left, rotation taken into account). */
export function pageChars(lib, page, scale = 1) {
  const m = lib.module, size = page.getSize({ scale });
  const W = size.width, H = size.height;
  const tp = m._FPDFText_LoadPage(page.pageIdx);
  if (!tp) throw new Error('Page has no readable text.');
  const buf = m.wasmExports.malloc(64);
  try {
    const n = m._FPDFText_CountChars(tp);
    const chars = [];
    for (let i = 0; i < n; i++) {
      const cp = m._FPDFText_GetUnicode(tp, i);
      const gen = m._FPDFText_IsGenerated(tp, i) === 1;
      let rect = null;
      if (!gen && m._FPDFText_GetCharBox(tp, i, buf, buf + 8, buf + 16, buf + 24)) {
        const [l, r, b, t] = f64(m, buf, 4);
        const xs = [], ys = [];
        for (const [px, py] of [[l, b], [r, b], [l, t], [r, t]]) {
          m._FPDF_PageToDevice(page.pageIdx, 0, 0, W, H, 0, px, py, buf + 32, buf + 36);
          const dx = new Int32Array(m.HEAPU8.buffer, buf + 32, 2);
          xs.push(dx[0]); ys.push(dx[1]);
        }
        rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      let origin = null, fs = 0;
      if (rect && m._FPDFText_GetCharOrigin(tp, i, buf + 48, buf + 56)) {
        const [ox, oy] = f64(m, buf + 48, 2);
        m._FPDF_PageToDevice(page.pageIdx, 0, 0, W, H, 0, ox, oy, buf + 32, buf + 36);
        const dv = new Int32Array(m.HEAPU8.buffer, buf + 32, 2); origin = [dv[0], dv[1]]; fs = m._FPDFText_GetFontSize(tp, i);
      }
      chars.push({ ch: cp ? String.fromCodePoint(cp) : '', rect, gen, origin, fontSize: fs });
    }
    // text as string + mapping string position -> character index
    let text = ''; const map = [];
    chars.forEach((c, i) => { for (let k = 0; k < c.ch.length; k++) map.push(i); text += c.ch; });
    return { text, map, chars, width: W, height: H };
  } finally { m.wasmExports.free(buf); m._FPDFText_ClosePage(tp); }
}

/** Finds matches (regex with g flag) in the page text and returns pixel rectangles per match. */
export function findMatches(pc, regex) {
  const out = [];
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(pc.text))) {
    if (!m[0]) { regex.lastIndex++; continue; }
    const idx = new Set();
    for (let p = m.index; p < m.index + m[0].length; p++) idx.add(pc.map[p]);
    const rects = [...idx].map((i) => pc.chars[i].rect).filter(Boolean);
    out.push({ text: m[0], index: m.index, rects });
  }
  return out;
}

/** Merges rectangles of the same line into one bar and enlarges it so that ascenders, descenders and letter edges are safely covered. */
export function mergeRects(rects, grow = 0.2) {
  let r = rects.map((a) => a.slice());
  const near = (a, b) => { const g = 0.6 * Math.max(Math.min(a[3] - a[1], a[2] - a[0]), Math.min(b[3] - b[1], b[2] - b[0])) + 1;
    return a[0] - g <= b[2] && b[0] - g <= a[2] && a[1] - g <= b[3] && b[1] - g <= a[3]; };
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (near(r[i], r[j])) {
      r[i] = [Math.min(r[i][0], r[j][0]), Math.min(r[i][1], r[j][1]), Math.max(r[i][2], r[j][2]), Math.max(r[i][3], r[j][3])]; r.splice(j, 1); changed = true; break outer;
    }
  }
  return r.map(([a, b, c, d]) => { const p = Math.max(2, grow * Math.min(c - a, d - b)); return [a - p, b - p, c + p, d + p]; });
}

/** Character rectangles of a match (in reading order) -> one bar per line (also vertical), slightly enlarged. */
export function lineBars(rects, grow = 0.2) {
  const runs = []; let cur = null;
  const w = (r) => r[2] - r[0], h = (r) => r[3] - r[1], cx = (r) => (r[0] + r[2]) / 2, cy = (r) => (r[1] + r[3]) / 2;
  for (const r of rects) {
    if (!cur) { cur = { box: r.slice(), last: r, axis: null }; continue; }
    const dx = cx(r) - cx(cur.last), dy = cy(r) - cy(cur.last);
    if (!cur.axis) cur.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    const cross = cur.axis === 'h' ? Math.abs(dy) : Math.abs(dx), size = cur.axis === 'h' ? Math.max(h(r), h(cur.last)) : Math.max(w(r), w(cur.last));
    if (cross > 0.6 * size) { runs.push(cur.box); cur = { box: r.slice(), last: r, axis: null }; continue; }
    cur.box = [Math.min(cur.box[0], r[0]), Math.min(cur.box[1], r[1]), Math.max(cur.box[2], r[2]), Math.max(cur.box[3], r[3])]; cur.last = r;
  }
  if (cur) runs.push(cur.box);
  return runs.map(([a, b, c, d]) => { const p = Math.max(2, grow * Math.min(c - a, d - b)); return [a - p, b - p, c + p, d + p]; });
}

/** Renders the page as an RGBA image. */
export async function renderPage(page, scale) {
  const r = await page.render({ scale, render: 'bitmap', renderFormFields: true });
  return { rgba: r.data, width: r.width, height: r.height, ptW: r.originalWidth, ptH: r.originalHeight };
}

/** Paints black rectangles (pixels) into an RGBA image – afterwards the image holds no information underneath. */
export function blackout(img, rects, pad = 2) {
  const { rgba, width: W, height: H } = img;
  for (const [x0, y0, x1, y1] of rects) {
    const a = Math.max(0, Math.floor(x0 - pad)), b = Math.max(0, Math.floor(y0 - pad));
    const c = Math.min(W, Math.ceil(x1 + pad)), d = Math.min(H, Math.ceil(y1 + pad));
    for (let y = b; y < d; y++) for (let x = a; x < c; x++) { const o = (y * W + x) * 4; rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255; }
  }
}

// ---- PNG (RGB, no extra packages)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), t = Buffer.from(type, 'ascii');
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, Buffer.from(data)])), 8 + data.length); return out;
}
export function encodePng({ rgba, width: W, height: H }) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1); raw[row] = 0;
    for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, d = row + 1 + x * 3; raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
