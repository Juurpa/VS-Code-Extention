// Independent check of a redacted PDF, as described in CLAUDE.md (does not use the redaction engine).
// Usage: node verify-redaction.mjs <redacted.pdf> <invoice.expect.json>
//  1. pdftotext (poppler): none of the "gone" strings may appear, all "kept" strings must.
//  2. raw scan of the file bytes and of every inflated stream for the "gone" strings.
// (qpdf --qdf could be added where available; it is not installed in the screenshot environment.)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
const [pdf, expectFile] = process.argv.slice(2);
const e = JSON.parse(fs.readFileSync(expectFile, 'utf8')), bytes = fs.readFileSync(pdf);
let bad = 0;
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
for (const g of e.gone) { const hit = text.includes(g); if (hit) bad++; console.log(`pdftotext  gone ${JSON.stringify(g).padEnd(34)} ${hit ? 'STILL PRESENT' : 'ok'}`); }
for (const k of e.kept) { const hit = text.includes(k); if (!hit) bad++; console.log(`pdftotext  kept ${JSON.stringify(k).padEnd(34)} ${hit ? 'ok' : 'MISSING'}`); }
const chunks = [bytes];
const re = /stream\r?\n([\s\S]*?)endstream/g, bin = bytes.toString('latin1'); let m;
while ((m = re.exec(bin))) { const raw = Buffer.from(m[1], 'latin1'); try { chunks.push(zlib.inflateSync(raw)); } catch { /* not flate */ } }
// pdf-lib and others write text as hex strings (<4a616e65>), so look for the literal and the hex form (also with spaces/case variations)
const hexOf = (g) => Buffer.from(g, 'latin1').toString('hex');
for (const g of e.gone) {
  const n = Buffer.from(g, 'latin1'), hx = hexOf(g);
  const hit = chunks.some((c) => c.includes(n) || c.toString('latin1').toLowerCase().replace(/\s+/g, '').includes(hx));
  if (hit) bad++; console.log(`raw bytes  gone ${JSON.stringify(g).padEnd(34)} ${hit ? 'STILL PRESENT' : 'ok'}`);
}
console.log(bad ? `FAILED (${bad})` : 'OK: redacted strings are gone, the rest of the text is intact');
process.exit(bad ? 1 : 0);
