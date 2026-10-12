// Built-in text recognition (OCR): Tesseract as WebAssembly, everything local, no network connection.
// A page is rendered, preprocessed (shadows, noise), recognized, and the text is placed as an invisible layer
// exactly behind the words in the image. The image itself stays unchanged.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import { PDFDocument, PDFOperator, PDFNumber, PDFArray, beginText, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, TextRenderingMode } from '../media/lib/pdf-lib.esm.min.js';
import fontkit from '@pdf-lib/fontkit';
import { openPdf, renderPage, encodePng } from './pdftext.mjs';
import { FONT_FILE } from './textlayer.mjs';

const require = createRequire(import.meta.url);
export const DATA_DIR = fileURLToPath(new URL('../ocr-data/', import.meta.url));
export const LANGS = { deu: 'Deutsch', eng: 'Englisch' };

// ------------------------------------------------------------------ Preprocess image
/** RGBA -> grayscale with an even background (removes shadows/gradients), light denoising and contrast. */
export function enhance(rgba, W, H) {
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  // estimate background: downscale, remove dark text with a "maximum" filter, smooth
  const f = Math.max(2, Math.round(Math.min(W, H) / 220)), w = Math.ceil(W / f), h = Math.ceil(H / f);
  let s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let yy = y * f; yy < Math.min(H, y * f + f); yy++) for (let xx = x * f; xx < Math.min(W, x * f + f); xx++) { sum += g[yy * W + xx]; n++; }
    s[y * w + x] = sum / n;
  }
  const maxf = (src, r) => {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]); tmp[y * w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]); out[y * w + x] = m; }
    return out;
  };
  const blur = (src, r) => {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let acc = 0, cnt = 0; for (let x = 0; x < w + r; x++) { if (x < w) { acc += src[y * w + x]; cnt++; } if (x - r - 1 >= 0) { acc -= src[y * w + x - r - 1]; cnt--; } if (x - r >= 0) tmp[y * w + x - r] = acc / cnt; } }
    for (let x = 0; x < w; x++) { let acc = 0, cnt = 0; for (let y = 0; y < h + r; y++) { if (y < h) { acc += tmp[y * w + x]; cnt++; } if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * w + x]; cnt--; } if (y - r >= 0) out[(y - r) * w + x] = acc / cnt; } }
    return out;
  };
  const rad = Math.max(2, Math.round(30 / f));
  s = blur(maxf(s, rad), Math.max(1, rad >> 1));
  // normalize: pixel / background (bilinearly upscaled)
  const out = new Uint8Array(W * H);
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, y / f), y0 = fy | 0, y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, x / f), x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const bg = (s[y0 * w + x0] * (1 - tx) + s[y0 * w + x1] * tx) * (1 - ty) + (s[y1 * w + x0] * (1 - tx) + s[y1 * w + x1] * tx) * ty;
      const v = Math.min(255, Math.round((g[y * W + x] / Math.max(40, bg)) * 255));
      out[y * W + x] = v; hist[v]++;
    }
  }
  // light denoising (3x3 mean only if the image is visibly noisy), then stretch contrast
  let noisy = 0; for (let i = 0; i < 2000; i++) { const p = ((i * 7919) % (W * H - W - 2)) + 1; if (Math.abs(out[p] - out[p + 1]) > 14 && out[p] > 150 && out[p + 1] > 150) noisy++; }
  let res = out;
  if (noisy > 60) {
    res = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; res[i] = (out[i - W - 1] + out[i - W] + out[i - W + 1] + out[i - 1] + 4 * out[i] + out[i + 1] + out[i + W - 1] + out[i + W] + out[i + W + 1]) >> 3; }
  }
  let lo = 0, hi = 255, acc = 0; const tot = W * H;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > tot * 0.005) { lo = v; break; } }
  for (let v = 255; v >= 0; v--) { if (hist[v] > tot * 0.2) { hi = v; break; } }
  if (hi - lo > 60) for (let i = 0; i < res.length; i++) res[i] = Math.max(0, Math.min(255, ((res[i] - lo) * 255) / (hi - lo)));
  return removeRules(res, W, H);
}

/** Removes long thin lines (table borders, form fields) that disturb line detection. */
function removeRules(g, W, H) {
  const out = g.slice(), T = 140, light = 170, d = 7;
  const minH = Math.round(W / 24), minV = Math.round(H / 24);
  for (let y = d; y < H - d; y++) {
    let x = 0;
    while (x < W) {
      if (g[y * W + x] >= T) { x++; continue; }
      let e = x; while (e < W && g[y * W + e] < T) e++;
      if (e - x >= minH) { const m = (x + e) >> 1; if (g[(y - d) * W + m] > light && g[(y + d) * W + m] > light) for (let k = x; k < e; k++) out[y * W + k] = 255; }
      x = e;
    }
  }
  for (let x = d; x < W - d; x++) {
    let y = 0;
    while (y < H) {
      if (g[y * W + x] >= T) { y++; continue; }
      let e = y; while (e < H && g[e * W + x] < T) e++;
      if (e - y >= minV) { const m = (y + e) >> 1; if (g[m * W + x - d] > light && g[m * W + x + d] > light) for (let k = y; k < e; k++) out[k * W + x] = 255; }
      y = e;
    }
  }
  return out;
}

function grayToRgba(gray, W, H) { const o = new Uint8Array(W * H * 4); for (let i = 0; i < gray.length; i++) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = gray[i]; o[i * 4 + 3] = 255; } return { rgba: o, width: W, height: H }; }

/** Rotates grayscale by 90° steps (clockwise). */
function rotateGray(g, W, H, deg) {
  if (!deg) return { g, W, H };
  if (deg === 180) { const o = new Uint8Array(g.length); for (let i = 0; i < g.length; i++) o[g.length - 1 - i] = g[i]; return { g: o, W, H }; }
  const o = new Uint8Array(g.length);
  if (deg === 90) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[x * H + (H - 1 - y)] = g[y * W + x]; return { g: o, W: H, H: W }; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[(W - 1 - x) * H + y] = g[y * W + x]; // 270
  return { g: o, W: H, H: W };
}
/** Maps a point from the rotated image back to the original image. */
function unrotatePt(x, y, W, H, deg) { // W,H = size of the original image
  if (deg === 90) return [y, H - x]; if (deg === 180) return [W - x, H - y]; if (deg === 270) return [W - y, x]; return [x, y];
}

// ------------------------------------------------------------------ Tesseract
let tess;
async function getTess() { return (tess ||= require('tesseract.js')); }

export class Engine {
  constructor(langs = ['deu', 'eng'], n = 1) { this.langs = langs; this.n = Math.max(1, n); this.workers = []; }
  async start() {
    const T = await getTess();
    for (const l of this.langs) if (!fs.existsSync(DATA_DIR + l + '.traineddata.gz')) throw new Error(`Sprachdaten fehlen: ${l}`);
    this.workers = await Promise.all(Array.from({ length: this.n }, () => T.createWorker(this.langs, 1, { langPath: DATA_DIR, gzip: true, cacheMethod: 'none' })));
    return this;
  }
  /** psm: '3' = whole page automatic, '11' = sparse text (tables, forms). */
  async recognize(png, i = 0, psm = '3') {
    const w = this.workers[i % this.workers.length];
    if (w.__psm !== psm) { await w.setParameters({ tessedit_pageseg_mode: psm }); w.__psm = psm; }
    const r = await w.recognize(Buffer.from(png), {}, { blocks: true, text: true });
    return r.data;
  }
  async stop() { await Promise.all(this.workers.map((w) => w.terminate().catch(() => {}))); this.workers = []; }
}

function linesOf(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  return out;
}

const wordCount = (rec) => rec.lines.reduce((a, l) => a + l.words.length, 0);
const quality = (rec) => rec.lines.reduce((a, l) => a + l.words.reduce((b, w) => b + (w.conf >= 60 ? w.text.length : 0), 0), 0);
// ------------------------------------------------------------------ Recognize page
const half = (g, W, H) => { const w = W >> 1, h = H >> 1, o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * W + 2 * x; o[y * w + x] = (g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) >> 2; } return { g: o, W: w, H: h }; };
/** Is the text horizontal (0°/180°) or vertical (90°/270°)? Text lines cause strong swings in the line profile. */
function axisOf(g, W, H) {
  const f = 4, w = W >> 2, h = H >> 2, rows = new Float64Array(h), cols = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let d = 0; for (let k = 0; k < f; k++) for (let l = 0; l < f; l++) if (g[(y * f + k) * W + x * f + l] < 128) d++; rows[y] += d; cols[x] += d; }
  const vr = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length; };
  return vr(cols) > vr(rows) * 1.25 ? [90, 270] : [0, 180];
}
const score = (d) => { let sc = 0, n = 0, c = 0; for (const l of linesOf(d)) for (const w of l.words || []) if (w.confidence >= 60 && /\p{L}/u.test(w.text || '')) { sc += (w.text.length * w.confidence) / 100; n++; c += w.confidence; } return { sc, n, mean: n ? c / n : 0 }; };

async function recognizePage(engine, rgba, W, H, wi, fast = false) {
  const gray = enhance(rgba, W, H);
  // determine orientation: first the axis (horizontal/vertical), then decide between the two directions at half resolution
  const cand = axisOf(gray, W, H), tried = [];
  const probe = async (deg) => { const r = rotateGray(gray, W, H, deg), h2 = half(r.g, r.W, r.H); const d = await engine.recognize(encodePng(grayToRgba(h2.g, h2.W, h2.H)), wi, '3'); const sc = score(d); tried.push([deg, Math.round(sc.sc)]); return sc; };
  let deg = cand[0], first = await probe(cand[0]);
  if (!(first.mean >= 80 && first.n >= 5)) { const second = await probe(cand[1]); if (second.sc > first.sc * 1.2) deg = cand[1]; }
  const r = rotateGray(gray, W, H, deg);
  const data = await engine.recognize(encodePng(grayToRgba(r.g, r.W, r.H)), wi, '3');
  const best = { deg, data, conf: data.confidence || 0 };
  const rotated = tried;
  // second pass for tables and forms: words the first pass missed are added
  let sparse = null;
  if (!fast) try {
    const r = rotateGray(gray, W, H, best.deg);
    sparse = await engine.recognize(encodePng(grayToRgba(r.g, r.W, r.H)), wi, '11');
  } catch (e) { /* supplement is optional */ }

  const conv = (data) => {
    const lines = [];
    for (const l of linesOf(data)) {
      const words = (l.words || []).map((w) => {
        let t = String(w.text || '').trim();
        const core = t.replace(/^[{}|[\]_~<>^]+|[{}|[\]_~<>^]+$/g, '');
        if (/[\p{L}\p{N}]/u.test(core)) t = core;
        return { text: t, conf: w.confidence, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 };
      }).filter((w) => w.text && /[\p{L}\p{N}€$%§@]/u.test(w.text) && w.conf >= 25 && !(w.text.length <= 3 && w.conf < 50));
      if (!words.length) continue;
      let ang = 0;
      if (best.deg === 0 && l.baseline && l.baseline.x1 - l.baseline.x0 > 150) ang = Math.atan2(l.baseline.y1 - l.baseline.y0, l.baseline.x1 - l.baseline.x0);
      if (Math.abs(ang) > 0.17) ang = 0;
      lines.push({ words, ang });
    }
    return lines;
  };
  const lines = conv(best.data);
  if (sparse) {
    const have = lines.flatMap((l) => l.words);
    const covered = (w) => have.some((h) => { const ix = Math.min(w.x1, h.x1) - Math.max(w.x0, h.x0), iy = Math.min(w.y1, h.y1) - Math.max(w.y0, h.y0); return ix > 0 && iy > 0 && (ix * iy) / ((w.x1 - w.x0) * (w.y1 - w.y0) || 1) > 0.3; });
    for (const l of conv(sparse)) {
      const words = l.words.filter((w) => !covered(w));
      if (!words.length) continue;
      const cy = words.reduce((a, w) => a + (w.y0 + w.y1) / 2, 0) / words.length, x0 = words[0].x0, x1 = words[words.length - 1].x1;
      // insert after the last line above it in the same column
      let at = lines.length;
      for (let i = lines.length - 1; i >= 0; i--) { const L = lines[i].words, ly = (L[0].y0 + L[0].y1) / 2, lx0 = L[0].x0, lx1 = L[L.length - 1].x1; if (ly <= cy && Math.min(x1, lx1) > Math.max(x0, lx0)) { at = i + 1; break; } }
      lines.splice(at, 0, { words, ang: l.ang, extra: true });
    }
  }
  return { lines, conf: best.conf, rotatedBy: best.deg, tried: rotated, W, H };
}

// ------------------------------------------------------------------ Write text layer
function toUser(R, Wu, Hu, X, Y) { return R === 0 ? [X, Hu - Y] : R === 90 ? [Y, X] : R === 180 ? [Wu - X, Y] : [Wu - Y, Hu - X]; }

/** Writes the recognized words as invisible text. Word boxes are in the frame of the upright-rotated image
 *  (res.rotatedBy); each point is mapped back to the page image and then to page coordinates (incl. /Rotate). */
function writeLayer(out, page, font, res, pxPerPt) {
  const set = new Set(font.getCharacterSet());
  const box = page.getCropBox(); const Wu = box.width, Hu = box.height, ox = box.x, oy = box.y;
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  const pt = (xt, yt) => { const [X, Y] = unrotatePt(xt, yt, res.W, res.H, res.rotatedBy); const [ux, uy] = toUser(R, Wu, Hu, X / pxPerPt, Y / pxPerPt); return [ox + ux, oy + uy]; };
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let written = 0;
  for (const line of res.lines) {
    // font size from the line height (ascender to descender ≈ 1.12 em), outliers handled via median
    const hs = line.words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
    const lineH = Math.max(hs[hs.length >> 1], hs[hs.length - 1] * 0.8);
    const size = Math.max(2, lineH / pxPerPt / 1.12);
    // common baseline per line (median): keeps text extraction clean even on skewed scans
    const bases = line.words.map((w) => w.y1 - (/[gjpqy,;()Q]/.test(w.text) ? 0.21 * size * pxPerPt : 0)).sort((a, b) => a - b);
    const lineBase = bases[bases.length >> 1];
    line.words.forEach((w, idx) => {
      const txt = [...w.text].filter((c) => set.has(c.codePointAt(0))).join('');
      if (!txt) return;
      const last = idx === line.words.length - 1;
      const natural = font.widthOfTextAtSize(txt, size), want = (w.x1 - w.x0) / pxPerPt;
      const k = Math.max(0.25, Math.min(4, want / Math.max(0.01, natural)));
      const p0 = pt(w.x0, lineBase), px = pt(w.x0 + 1, lineBase), pu = pt(w.x0, lineBase - 1);
      const dir = [(px[0] - p0[0]) * pxPerPt, (px[1] - p0[1]) * pxPerPt], up = [(pu[0] - p0[0]) * pxPerPt, (pu[1] - p0[1]) * pxPerPt];
      const arr = PDFArray.withContext(out.context);
      arr.push(font.encodeText(last ? txt : txt + ' '));
      ops.push(setFontAndSize(key, size), setTextMatrix(dir[0] * k, dir[1] * k, up[0], up[1], p0[0], p0[1]), PDFOperator.of('TJ', [arr]));
      written++;
    });
  }
  ops.push(endText());
  page.pushOperators(...ops);
  return written;
}

// ------------------------------------------------------------------ Public functions
/** Which pages have no text (probably scans)? Returns page number and text character count per page. */
export async function detectScanned(bytes) {
  const o = await openPdf(bytes);
  try {
    const m = o.lib.module, res = [];
    for (let i = 0; i < o.count; i++) {
      const page = o.doc.getPage(i), tp = m._FPDFText_LoadPage(page.pageIdx);
      let n = 0;
      if (tp) { n = m._FPDFText_CountChars(tp); m._FPDFText_ClosePage(tp); }
      res.push({ page: i + 1, chars: n, scanned: n < 5 });
    }
    return res;
  } finally { o.close(); }
}

/** Text recognition for pages. opt: { pages:[1-based]|null (=all without text), langs, dpi, force, workers, onProgress } */
export async function ocrPdf(bytes, opt = {}) {
  const langs = opt.langs && opt.langs.length ? opt.langs : ['deu', 'eng'];
  const dpi = Math.min(400, Math.max(150, opt.dpi || (opt.fast ? 250 : 300)));
  const status = await detectScanned(bytes);
  let todo = opt.pages && opt.pages.length ? opt.pages.filter((p) => p >= 1 && p <= status.length) : status.filter((s) => s.scanned).map((s) => s.page);
  const skipped = [];
  if (!opt.force) { const keep = []; for (const p of todo) (status[p - 1].scanned ? keep : skipped).push(p); todo = keep; }
  if (!todo.length) return { bytes: null, pages: [], skipped, message: 'No page needs text recognition.' };

  const workers = Math.max(1, Math.min(opt.workers || Math.max(1, Math.min(3, os.cpus().length - 1)), todo.length));
  const engine = await new Engine(langs, workers).start();
  const o = await openPdf(bytes);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT_FILE), { subset: true });
  const results = []; let done = 0;
  try {
    // render pages one after another (memory), recognize in parallel on the workers
    const queue = [...todo]; const pending = [];
    const runOne = async (wi) => {
      try {
      while (queue.length) {
        const p = queue.shift(), page = o.doc.getPage(p - 1);
        let r = await renderPage(page, dpi / 72);
        if (opt.signal && opt.signal.aborted) throw new Error('Cancelled.');
        let rec = await recognizePage(engine, r.rgba, r.width, r.height, wi, !!opt.fast);
        let pxPerPt = r.width / r.ptW;
        // weak recognition often occurs with small print: retry once at a higher resolution and keep the better result
        if ((rec.conf < 72 || wordCount(rec) < 4) && dpi < 400) {
          const r2 = await renderPage(page, Math.min(400, Math.round(dpi * 1.4)) / 72);
          const rec2 = await recognizePage(engine, r2.rgba, r2.width, r2.height, wi, !!opt.fast);
          if (quality(rec2) > quality(rec)) { rec = rec2; r = r2; pxPerPt = r2.width / r2.ptW; }
        }
        const n = rec.lines.length ? writeLayer(doc, doc.getPage(p - 1), font, rec, pxPerPt) : 0;
        results.push({ page: p, words: n, conf: Math.round(rec.conf), turned: rec.rotatedBy, lowConf: rec.conf < 40 });
        done++; opt.onProgress && opt.onProgress({ done, total: todo.length, page: p });
      }
      } catch (e) { queue.length = 0; throw e; }
    };
    if (opt.signal) opt.signal.addEventListener('abort', () => { queue.length = 0; engine.stop(); }, { once: true });
    for (let i = 0; i < workers; i++) pending.push(runOne(i));
    const settled = await Promise.allSettled(pending);
    if (opt.signal && opt.signal.aborted) throw new Error('Cancelled.');
    const bad = settled.find((x) => x.status === 'rejected'); if (bad) throw bad.reason;
  } finally { o.close(); await engine.stop(); }
  results.sort((a, b) => a.page - b.page);
  const out = await doc.save();
  return { bytes: out, pages: results, skipped, langs };
}
