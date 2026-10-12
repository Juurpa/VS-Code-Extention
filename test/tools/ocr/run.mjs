import fs from 'node:fs';
import { ocrPdf } from '/home/claude/lernmodus-vscode/mcp/ocr.mjs';
const t=Date.now();
const r = await ocrPdf(new Uint8Array(fs.readFileSync(process.argv[2])), { onProgress: (p)=>console.log('progress',p.done,'/',p.total) });
console.log(JSON.stringify({pages:r.pages,skipped:r.skipped}), (Date.now()-t)+'ms');
if (r.bytes) fs.writeFileSync(process.argv[3], r.bytes);
