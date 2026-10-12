import fs from 'node:fs';
import { openPdf, pageChars } from '/home/claude/lernmodus-vscode/mcp/pdftext.mjs';
const words = async (f) => { const o = await openPdf(new Uint8Array(fs.readFileSync(f))); const p = o.doc.getPage(0); const pc = pageChars(o.lib, p, 1); const out = []; const re = /\S+/g; let m; while ((m = re.exec(pc.text))) { const cs = []; for (let k = m.index; k < m.index + m[0].length; k++) { const c = pc.chars[pc.map[k]]; if (c.rect) cs.push(c.rect); } if (!cs.length) continue; out.push({ t: m[0], x0: Math.min(...cs.map(r => r[0])), x1: Math.max(...cs.map(r => r[2])), y0: Math.min(...cs.map(r => r[1])), y1: Math.max(...cs.map(r => r[3])) }); } o.close(); return out; };
const A = await words(process.argv[2]), B = await words(process.argv[3]);
let n = 0, dx = [], dy = [], dw = [], dh = [];
for (const b of B) { const a = A.find(a => a.t === b.t && Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < 30 && Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < 30); if (!a) continue; n++; dx.push((b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2); dy.push((b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2); dw.push((b.x1 - b.x0) / (a.x1 - a.x0)); dh.push((b.y1 - b.y0) / (a.y1 - a.y0)); }
const st = (v) => `mean ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2)} max|.| ${Math.max(...v.map(Math.abs)).toFixed(2)}`;
console.log('matched', n, 'of', B.length, '\n dx(pt)', st(dx), '\n dy(pt)', st(dy), '\n width ratio', st(dw.map(x => x - 1)), '\n height ratio', st(dh.map(x => x - 1)));
