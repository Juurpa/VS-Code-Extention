// Turns one PDF page into a synthetic, degraded "scan" (image-only PDF): shadow, noise, slight skew.
// Usage: node make-scan.mjs <source.pdf> <page0> <out.pdf> [skewDegrees=1.1] [dpi=200]
// (Adapted from ../ocr/mkscan.mjs, with repo-relative imports.)
import fs from 'node:fs';
import { openPdf, renderPage, encodePng } from '../../../mcp/pdftext.mjs';
import { PDFDocument } from '../../../media/lib/pdf-lib.esm.min.js';
const [src, pg = '0', out, skewArg = '1.1', dpiArg = '200'] = process.argv.slice(2);
const skew = +skewArg, dpi = +dpiArg;
const o = await openPdf(new Uint8Array(fs.readFileSync(src)));
const r = await renderPage(o.doc.getPage(+pg), dpi / 72), W = r.width, H = r.height;
const g = new Float32Array(W * H); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const c = Math.cos(skew * Math.PI / 180), s = Math.sin(skew * Math.PI / 180);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x - W / 2, dy = y - H / 2, sx = c * dx + s * dy + W / 2, sy = -s * dx + c * dy + H / 2;
  let v = 255;
  if (sx >= 0 && sy >= 0 && sx < W - 1 && sy < H - 1) { const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy; const p = (X, Y) => { const k = (Y * W + X) * 4; return 0.299 * r.rgba[k] + 0.587 * r.rgba[k + 1] + 0.114 * r.rgba[k + 2]; }; v = p(ix, iy) * (1 - fx) * (1 - fy) + p(ix + 1, iy) * fx * (1 - fy) + p(ix, iy + 1) * (1 - fx) * fy + p(ix + 1, iy + 1) * fx * fy; }
  const shade = 0.82 + 0.18 * (x / W) * (1 - 0.3 * y / H);
  g[y * W + x] = Math.max(0, Math.min(255, v * shade + (rnd() - 0.5) * 30));
}
const rgba = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i]; rgba[i * 4 + 3] = 255; }
const doc = await PDFDocument.create(); doc.setTitle('Scanned page');
const img = await doc.embedPng(encodePng({ rgba, width: W, height: H }));
const p = doc.addPage([r.ptW, r.ptH]); p.drawImage(img, { x: 0, y: 0, width: r.ptW, height: r.ptH });
fs.writeFileSync(out, await doc.save()); console.log('scan', out, W, H, 'skew', skew);
o.close();
