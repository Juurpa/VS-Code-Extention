// Images, Word (.docx) and PowerPoint (.pptx) open as a PDF: the file is turned into a PDF here in the viewer,
// so every tool (OCR, highlight, redact, AI …) works on it. The original file is never changed; saving writes a new PDF.
// Images are embedded unchanged (lossless). Word/PowerPoint are drawn by docx-preview / pptx-renderer, each page
// becomes an image, and the extension puts an invisible text layer exactly over the words (positions from the browser).
import { PDFDocument, degrees } from './lib/pdf-lib.esm.min.js';

const A4 = [595.28, 841.89];
const PT = 0.75;        // pt per CSS pixel (96 dpi)
const RATIO = 2;        // render resolution for Word/PowerPoint pages (192 dpi)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Images
/** Page size for an image: 96 dpi, but at most A4 (in the orientation of the image), so photos print sensibly. */
function fitPage(wPx, hPx) {
  const w = wPx * PT, h = hPx * PT, [mw, mh] = w > h ? [A4[1], A4[0]] : A4;
  const k = Math.min(1, mw / w, mh / h);
  return [w * k, h * k];
}

/** EXIF orientation of a JPEG (1 = upright). Phones store photos sideways and only set this flag. */
export function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  for (let i = 2; i + 4 < b.length;) {
    if (b[i] !== 0xff) return 1;
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xda || m === 0xd9) return 1;             // image data starts: no EXIF before it
    if (m === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (u16(o) | (u16(o + 2) << 16)) : ((u16(o) << 16) | u16(o + 2))) >>> 0;
      const ifd = u32(4), n = u16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) return u16(e + 8) || 1; }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Decodes any image the browser can show (orientation applied) and re-encodes it. */
async function viaCanvas(bytes, jpeg) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); if (jpeg) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0); bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.95));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), jpeg };
}

async function imageToPdf(bytes) {
  const doc = await PDFDocument.create();
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8, isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  let img = null, rot = 0;
  try {
    if (isJpg) {
      const o = jpegOrientation(bytes);
      if ([1, 3, 6, 8].includes(o)) { img = await doc.embedJpg(bytes); rot = { 1: 0, 3: 180, 6: 90, 8: 270 }[o]; }
    } else if (isPng) img = await doc.embedPng(bytes);
  } catch (e) { img = null; }
  if (!img) { // GIF, BMP, WebP, mirrored photos, unusual PNG/JPEG variants
    const r = await viaCanvas(bytes, isJpg);
    img = r.jpeg ? await doc.embedJpg(r.bytes) : await doc.embedPng(r.bytes); rot = 0;
  }
  const side = rot % 180 !== 0;
  const [W, H] = fitPage(side ? img.height : img.width, side ? img.width : img.height);
  const w = side ? H : W, h = side ? W : H;           // size of the unrotated image on the page
  const page = doc.addPage([W, H]);
  // pdf-lib turns counter-clockwise around (x, y); a clockwise EXIF turn is a negative angle
  const at = { 0: [0, 0], 90: [0, H], 180: [W, H], 270: [W, 0] }[rot];
  page.drawImage(img, { x: at[0], y: at[1], width: w, height: h, rotate: degrees(-rot) });
  return doc.save();
}

// ------------------------------------------------------------------ Word / PowerPoint
const loaded = new Map();
function loadScript(url) {
  if (!loaded.has(url)) loaded.set(url, new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.onload = res;
    s.onerror = () => { loaded.delete(url); rej(new Error('Could not load ' + url.split('/').pop())); };
    document.head.append(s);
  }));
  return loaded.get(url);
}

function makeStage() {
  // Off screen but laid out (positions and rendering need real layout)
  const st = document.createElement('div');
  st.style.cssText = 'position:fixed;left:-40000px;top:0;pointer-events:none;contain:layout style;';
  document.body.append(st);
  return st;
}

/** Words with their boxes (CSS px relative to root, top left origin) and font size; also inside SVG text. */
function wordsOf(root, scale = 1) {
  const base = root.getBoundingClientRect(), out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue; if (!s || !/\S/.test(s)) continue;
    const pe = n.parentElement; if (!pe || pe.closest('style,script,title')) continue;
    const cs = getComputedStyle(pe); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fs = (parseFloat(cs.fontSize) || 12) * scale;
    for (const m of s.matchAll(/\S+/g)) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const rs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rs.length) continue;
      // A word split over two lines (hyphenation, narrow cells): one entry per piece of the same height
      if (rs.length > 1 && rs.every((r) => Math.abs(r.top - rs[0].top) < 1)) rs.splice(0, rs.length, { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: rs[0].top, bottom: Math.max(...rs.map((r) => r.bottom)) });
      if (rs.length > 1) continue;
      const r = rs[0], x0 = (r.left - base.left) / scale, x1 = (r.right - base.left) / scale, y0 = (r.top - base.top) / scale, y1 = (r.bottom - base.top) / scale;
      // tall narrow boxes are vertical text: positions would be wrong, the text layer leaves them out
      if (m[0].length > 2 && (y1 - y0) > (x1 - x0) * 1.5) continue;
      out.push({ t: m[0], x0, y0, x1, y1, s: fs / scale });
    }
  }
  return out;
}

/** SVG (html-to-image) of an element, as a string; cut into pages with the viewBox. */
async function svgOf(elm, W, H) {
  const url = await window.htmlToImage.toSvg(elm, { width: W, height: H, backgroundColor: '#ffffff', skipFonts: false, cacheBust: false });
  return decodeURIComponent(url.slice(url.indexOf(',') + 1));
}
async function rasterize(svg, W, totalH, y, h, clip = null) {
  // the whole element stays in the foreignObject, the viewBox shows only [y, y+h]
  const piece = svg
    .replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${W * RATIO}" height="${h * RATIO}" viewBox="0 ${y} ${W} ${h}">`)
    .replace(/<foreignObject[^>]*>/, `<foreignObject x="0" y="0" width="${W}" height="${totalH}">`);
  const img = new Image(); img.decoding = 'sync';
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(piece);
  await img.decode();
  const c = document.createElement('canvas'); c.width = Math.round(W * RATIO); c.height = Math.round(h * RATIO);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  // clip = [top, bottom]: outside of it lies content of the neighbouring pages (the page is cut out of one long section)
  if (clip) { g.fillRect(0, 0, c.width, clip[0] * RATIO); g.fillRect(0, clip[1] * RATIO, c.width, c.height); }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Where a too long Word section is cut into pages: at the top of a paragraph or table row, never through a line. */
function cutPoints(sec, padTop, padBottom, pageH, totalH) {
  const top = sec.getBoundingClientRect().top;
  const cands = [...new Set([...sec.querySelectorAll('article > *, tr, li')].filter((e) => !e.closest('header,footer'))
    .map((e) => Math.round(e.getBoundingClientRect().top - top)))].sort((a, b) => a - b);
  const room = pageH - padTop - padBottom, pages = [];
  let start = 0, limit = pageH - padBottom;
  while (start < totalH - padBottom - 1) {
    let cut = Math.min(limit, totalH);
    const best = cands.filter((c) => c > start + room * 0.3 && c <= limit).pop();
    if (best !== undefined && limit < totalH) cut = best;
    pages.push([start, cut]);
    start = cut; limit = cut + room;
  }
  return pages.length ? pages : [[0, totalH]];
}

async function docxToPages(buf, media, onProgress) {
  await loadScript(media + '/lib/office/jszip.min.js');
  await loadScript(media + '/lib/office/docx-preview.min.js');
  await loadScript(media + '/lib/office/html-to-image.js');
  const st = makeStage(), styles = document.createElement('div'), body = document.createElement('div');
  st.append(styles, body);
  try {
    await window.docx.renderAsync(new Blob([buf]), body, styles, {
      inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, useBase64URL: true, experimental: true,
      renderComments: false, renderChanges: false, renderHeaders: true, renderFooters: true
    });
    await document.fonts.ready; await sleep(50);
    const secs = [...body.querySelectorAll('section.docx')], pages = [];
    let done = 0;
    for (const sec of secs) {
      sec.style.boxShadow = 'none'; sec.style.margin = '0';
      const cs = getComputedStyle(sec), W = sec.offsetWidth, totalH = sec.offsetHeight;
      const pageH = parseFloat(cs.minHeight) || totalH, padTop = parseFloat(cs.paddingTop) || 0, padBottom = parseFloat(cs.paddingBottom) || 0;
      const cuts = totalH > pageH + 2 ? cutPoints(sec, padTop, padBottom, pageH, totalH) : [[0, totalH]];
      const svg = await svgOf(sec, W, totalH), words = wordsOf(sec);
      for (let k = 0; k < cuts.length; k++) {
        const [a, b] = cuts[k], dy = k === 0 ? 0 : padTop;     // later pages: content starts below the top margin again
        const h = Math.max(pageH, b - a + dy), src = k === 0 ? [0, h] : [a - dy, h];
        const last = k === cuts.length - 1, clip = cuts.length > 1 ? [k === 0 ? 0 : dy, last ? h : b - src[0]] : null;
        const img = await rasterize(svg, W, totalH, src[0], h, clip);
        const pw = words.filter((w) => (w.y0 + w.y1) / 2 >= a && (w.y0 + w.y1) / 2 < b).map((w) => ({ ...w, y0: w.y0 - src[0], y1: w.y1 - src[0] }));
        pages.push({ img, fmt: 'jpg', pxW: W, pxH: h, words: pw });
        onProgress?.(++done);
      }
    }
    return pages;
  } finally { st.remove(); }
}

async function pptxToPages(buf, media, onProgress) {
  await loadScript(media + '/lib/office/html-to-image.js');
  const R = await import(media + '/lib/office/aiden0z-pptx-renderer.browser.es.js');
  const pres = R.buildPresentation(await R.parseZip(buf, R.RECOMMENDED_ZIP_LIMITS));
  const W = pres.width, H = pres.height, st = makeStage(), pages = [];
  try {
    for (const slide of pres.slides) {
      if (slide.hidden) continue;
      const h = R.renderSlide(pres, slide, { pdfjs: false, externalMedia: 'block' });
      const box = document.createElement('div'); box.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fff;`;
      box.append(h.element); st.append(box);
      try {
        await h.ready; await document.fonts.ready; await sleep(box.querySelector('canvas') ? 600 : 30); // charts draw animated
        const svg = await svgOf(box, W, H);
        pages.push({ img: await rasterize(svg, W, H, 0, H), fmt: 'jpg', pxW: W, pxH: H, words: wordsOf(box) });
      } finally { h.dispose(); box.remove(); }
      onProgress?.(pages.length);
    }
    return pages;
  } finally { st.remove(); }
}

/**
 * Turns an image / .docx / .pptx into PDF bytes.
 * buildPdf(pages) is done by the extension (text layer with an embedded font); see mcp/imgpdf.mjs.
 */
export async function toPdf(buf, kind, { media, buildPdf, onProgress }) {
  const bytes = new Uint8Array(buf);
  if (kind === 'image') return imageToPdf(bytes);
  const pages = kind === 'docx' ? await docxToPages(buf, media, onProgress) : await pptxToPages(buf, media, onProgress);
  if (!pages.length) throw new Error('The file has no pages.');
  return buildPdf(pages);
}
