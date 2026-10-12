import fs from 'node:fs';
import { openPdf, renderPage, encodePng } from '/home/claude/lernmodus-vscode/mcp/pdftext.mjs';
import { PDFDocument, degrees } from '/home/claude/lernmodus-vscode/media/lib/pdf-lib.esm.min.js';
const src = fs.readFileSync(process.argv[2]); const pg = +process.argv[3] || 0; const out = process.argv[4];
const rot = +process.argv[5] || 0; const skew = +process.argv[6] || 0; const dpi = +process.argv[7] || 200;
const o = await openPdf(new Uint8Array(src)); const page = o.doc.getPage(pg);
const r = await renderPage(page, dpi / 72); const W = r.width, H = r.height;
// gray + Schatten + Rauschen + Schiefstellung (bilinear)
const g = new Float32Array(W * H); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const c = Math.cos(skew * Math.PI / 180), s = Math.sin(skew * Math.PI / 180);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x - W / 2, dy = y - H / 2, sx = c * dx + s * dy + W / 2, sy = -s * dx + c * dy + H / 2;
  let v = 255; if (sx >= 0 && sy >= 0 && sx < W - 1 && sy < H - 1) { const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy; const p = (X, Y) => r.rgba[(Y * W + X) * 4]; v = p(ix, iy) * (1 - fx) * (1 - fy) + p(ix + 1, iy) * fx * (1 - fy) + p(ix, iy + 1) * (1 - fx) * fy + p(ix + 1, iy + 1) * fx * fy; }
  const shade = 0.78 + 0.22 * (x / W) * (1 - 0.3 * y / H);
  g[y * W + x] = Math.max(0, Math.min(255, v * shade + (rnd() - 0.5) * 36));
}
const rgba = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i]; rgba[i * 4 + 3] = 255; }
const png = encodePng({ rgba, width: W, height: H });
const doc = await PDFDocument.create(); const img = await doc.embedPng(png);
const pw = r.ptW, ph = r.ptH; const p = doc.addPage([pw, ph]); p.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
if (rot) p.setRotation(degrees(rot));
fs.writeFileSync(out, await doc.save()); console.log('scan', out, W, H, 'rot', rot, 'skew', skew);
o.close();
