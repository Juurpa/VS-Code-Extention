import fs from 'node:fs';
import * as ops from '/home/claude/lernmodus-vscode/mcp/ops.mjs';
const ocr = fs.readFileSync('s2_ocr.pdf');
const r = await ops.redactVerified(new Uint8Array(ocr), { terms: ['Max Mustermann'], kinds: ['iban'] });
console.log('found', r.found, 'modes', JSON.stringify(r.modes), 'verification', JSON.stringify(r.verification));
fs.writeFileSync('s2_ocr_red.pdf', r.bytes);
