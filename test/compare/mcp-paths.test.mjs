// Checks that the MCP server only writes where it should: inside the working folder, with the right file type,
// never through a link that leads out, never over an existing file. Run: node test/compare/mcp-paths.test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '../../media/lib/pdf-lib.esm.min.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '..', '..', 'mcp', 'server.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-root-')), outer = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-outer-'));
let fail = 0;
const ck = (n, ok, x = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + (x ? '  ' + String(x).slice(0, 150) : '')); if (!ok) fail++; };

async function pdf(text) { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); d.addPage([300, 300]).drawText(text, { x: 20, y: 250, size: 12, font: f }); return Buffer.from(await d.save()); }
fs.writeFileSync(path.join(root, 'a.pdf'), await pdf('hello world one'));
fs.writeFileSync(path.join(root, 'b.pdf'), await pdf('hello world two'));
fs.writeFileSync(path.join(outer, 'secret.pdf'), await pdf('top secret'));
let linked = true;
try { fs.symlinkSync(outer, path.join(root, 'link'), 'junction'); } catch (e) { linked = false; }

const child = spawn(process.execPath, [server], { env: { ...process.env, PDF_WORKBENCH_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', seq = 0; const waiting = new Map();
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch (e) { /* not JSON */ } } });
const rpc = (method, params) => new Promise((res) => { const id = ++seq; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const text = r.result?.content?.[0]?.text || JSON.stringify(r.error); return { err: !!r.result?.isError || !!r.error, text }; };

await rpc('initialize', { protocolVersion: '2024-11-05' });
const files = () => fs.readdirSync(root).sort().join(',');
const base = files();

let r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: '../escape.md' });
ck('out outside the folder is refused', r.err && !fs.existsSync(path.join(root, '..', 'escape.md')), r.text);
r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: 'notes.txt' });
ck('report must end with .md', r.err && !fs.existsSync(path.join(root, 'notes.txt')), r.text);
r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: '.vscode/tasks.json' });
ck('cannot create settings or script files', r.err && !fs.existsSync(path.join(root, '.vscode')), r.text);
r = await call('pdf_compress', { file: 'a.pdf', out: 'run.cmd' });
ck('other tools: result must end with .pdf', r.err && !fs.existsSync(path.join(root, 'run.cmd')), r.text);
if (linked) {
  r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: 'link/x.md' });
  ck('writing through a link that leads out is refused', r.err && !fs.existsSync(path.join(outer, 'x.md')), r.text);
  r = await call('pdf_read_text', { file: 'link/secret.pdf' });
  ck('reading through a link that leads out is refused', r.err && !r.text.includes('top secret'), r.text);
} else console.log('SKIP link tests (no junction possible here)');
r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: 'report.md' });
ck('normal compare writes the report', !r.err && fs.existsSync(path.join(root, 'report.md')) && JSON.parse(r.text).summary.changed === 1, r.text.slice(0, 80));
r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf', out: 'report.md' });
ck('an existing report is never overwritten', r.err, r.text);
r = await call('pdf_compare', { file_old: 'a.pdf', file_new: 'b.pdf' });
ck('default report name next to the old file', !r.err && /a_compare\.md$/.test(JSON.parse(r.text).report), r.text.slice(0, 60));

child.kill();
try { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outer, { recursive: true, force: true }); } catch (e) { /* temp folders */ }
console.log(fail ? '\nFAILED ' + fail : '\nALL PASSED'); process.exit(fail ? 1 : 0);
