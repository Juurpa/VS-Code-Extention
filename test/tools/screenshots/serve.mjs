// Local server for the screenshot harness (no VS Code needed).
//   node serve.mjs <data-dir> [port]
// - serves the repository root statically (media/*, etc.)
// - serves <data-dir> under /__data/ (demo PDFs live outside the repo)
// - /harness.html?pdf=<file in data-dir>&name=<title>&cursor=1  -> the webview page, built like extension.js html()
// - /api/redact, /api/ocrScan, /api/ocr -> the REAL engines (mcp/ops.mjs, mcp/ocr.mjs); /api/ocr streams NDJSON progress
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dataDir = path.resolve(process.argv[2] || path.join(here, 'data'));
const port = +process.argv[3] || 8765;
const require = createRequire(import.meta.url);
const bodyHtml = require(path.join(root, 'template.js'));
const ops = await import(pathToFileURL(path.join(root, 'mcp/ops.mjs')).href);
const ocr = await import(pathToFileURL(path.join(root, 'mcp/ocr.mjs')).href);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.bpc': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.gz': 'application/gzip' };

// VS Code "Dark Modern" values for the variables that media/main.css reads.
const THEME = `
:root{
 --vscode-font-family:"Segoe UI","Inter","Helvetica Neue",system-ui,sans-serif;--vscode-font-size:13px;
 --vscode-editor-background:#1f1f1f;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;
 --vscode-editorWidget-background:#202020;--vscode-editorHoverWidget-background:#202020;
 --vscode-panel-border:#2b2b2b;--vscode-input-background:#313131;--vscode-toolbar-hoverBackground:rgba(90,93,94,.31);
 --vscode-editorGroup-emptyBackground:#1f1f1f;--vscode-errorForeground:#f85149;
 --vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;
 color-scheme:dark}
::-webkit-scrollbar{width:14px;height:14px}::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(121,121,121,.4);border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:rgba(100,100,100,.7);background-clip:content-box}
::-webkit-scrollbar-corner{background:transparent}
#__cursor{position:fixed;left:-50px;top:-50px;width:22px;height:22px;z-index:99999;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
`;

// Mock of acquireVsCodeApi: answers the same message types as extension.js.
const MOCK = (origin) => `
window.__log = []; window.__errors = []; window.__ann = {};
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
const toB = (b) => { let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); };
const reply = (m, x) => setTimeout(() => postMessage({ type: 'reply', rid: m.rid, ...x }, '*'), 15);
const post = (o) => postMessage(o, '*');
window.acquireVsCodeApi = () => ({ postMessage: async (m) => {
  window.__log.push(m.type);
  try {
    switch (m.type) {
      case 'ready': setTimeout(() => post({ type: 'init', ann: window.__initAnn || {}, hasText: true, sig: null, ai: { id: 'claude-code', name: 'Claude', icon: '${origin}/media/icons/ai.png' } }), 40); break;
      case 'saveAnn': window.__ann = m.ann; break;
      case 'redact': { const r = await (await fetch('/api/redact', { method: 'POST', body: JSON.stringify({ b64: m.b64, boxes: m.boxes }) })).json(); reply(m, r); break; }
      case 'ocrScan': { const r = await (await fetch('/api/ocrScan', { method: 'POST', body: JSON.stringify({ b64: m.b64 }) })).json(); reply(m, r); break; }
      case 'ocr': {
        const res = await fetch('/api/ocr', { method: 'POST', body: JSON.stringify({ b64: m.b64, pages: m.pages, langs: m.langs, fast: m.fast, force: m.force }) });
        const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\\n')) >= 0) { const o = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (o.progress) post({ type: 'progress', rid: m.rid, ...o.progress }); else reply(m, o); } }
        break; }
      case 'pickPdfs': { const f = window.__pick || []; reply(m, { files: f }); break; }
      case 'confirmOverwrite': reply(m, { ok: true }); break;
      case 'saveFile': reply(m, { ok: true }); break;
      case 'saveAs': reply(m, { ok: true, name: m.suggested }); break;
      case 'saveMany': reply(m, { ok: true, names: m.files.map((f) => f.name) }); break;
      case 'jsError': window.__errors.push('host-jsError: ' + m.message); break;
      default: break; // saveText, claude, chooseAi, ... : nothing to do here
    }
  } catch (e) { reply(m, { ok: false, error: String(e && e.message || e) }); }
} });
`;

function harness(q, origin) {
  const cfg = { pdfUri: `${origin}/__data/${q.get('pdf') || 'invoice.pdf'}`, mediaUri: `${origin}/media`, name: q.get('name') || 'invoice.pdf', relPdf: q.get('name') || 'invoice.pdf', dataFolder: '_werkbank' };
  const cursor = q.get('cursor') ? `<svg id="__cursor" viewBox="0 0 24 24"><path d="M4 2l15 10-6.5 1.2L9.2 20z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg><script>addEventListener('mousemove',e=>{const c=document.getElementById('__cursor');c.style.left=e.clientX-3+'px';c.style.top=e.clientY-2+'px'},true)</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${THEME}</style>
<script>${MOCK(origin)}</script>
<link rel="stylesheet" href="${origin}/media/lib/textlayer.css"><link rel="stylesheet" href="${origin}/media/main.css">
</head><body class="vscode-dark">
<div id="cfg" hidden data-cfg='${JSON.stringify(cfg).replace(/'/g, '&#39;')}'></div>
${bodyHtml}${cursor}
<script type="module" src="${origin}/media/main.js"></script>
</body></html>`;
}

async function readBody(req) { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`), origin = `http://localhost:${port}`;
  try {
    if (u.pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    if (u.pathname === '/harness.html') { res.setHeader('content-type', MIME['.html']); res.end(harness(u.searchParams, origin)); return; }
    if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
      const m = await readBody(req), bytes = () => new Uint8Array(Buffer.from(m.b64, 'base64'));
      if (u.pathname === '/api/redact') {
        try {
          const r = await ops.redactVerified(bytes(), { boxes: m.boxes });
          if (!r.bytes) throw new Error('Nothing was redacted.');
          res.end(JSON.stringify({ ok: true, b64: Buffer.from(r.bytes).toString('base64'), verification: r.verification, pages: r.pagesChanged, modes: r.modes }));
        } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
      } else if (u.pathname === '/api/ocrScan') {
        try { res.end(JSON.stringify({ ok: true, pages: await ocr.detectScanned(bytes()) })); } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
      } else if (u.pathname === '/api/ocr') {
        res.setHeader('content-type', 'application/x-ndjson');
        try {
          const r = await ocr.ocrPdf(bytes(), { pages: m.pages, langs: m.langs, fast: !!m.fast, force: !!m.force, onProgress: (p) => res.write(JSON.stringify({ progress: p }) + '\n') });
          res.end(JSON.stringify({ ok: true, b64: r.bytes ? Buffer.from(r.bytes).toString('base64') : null, pages: r.pages, skipped: r.skipped, message: r.message }) + '\n');
        } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e.message || e) }) + '\n'); }
      } else { res.statusCode = 404; res.end('{}'); }
      return;
    }
    const base = u.pathname.startsWith('/__data/') ? dataDir : root, rel = decodeURIComponent(u.pathname.replace(/^\/__data\//, '/'));
    const f = path.join(base, path.normalize(rel));
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store');
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.statusCode = 500; res.end(String(e && e.message || e)); }
}).listen(port, () => console.log('screenshot server on http://localhost:' + port + ', data: ' + dataDir));
