#!/usr/bin/env node
// Werkbank MCP server: gives an AI (e.g. Claude Code) the PDF tools of the Werkbank.
// Runs locally over stdin/stdout. Files only inside the working folder (WERKBANK_ROOT, otherwise the current directory).
// Originals are never overwritten: results go to new files next to the original.
import './quiet.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ops, info, readText, find, redact, redactVerified, KINDS, parsePages } from './ops.mjs';
import { ocrPdf, detectScanned } from './ocr.mjs';

const ROOT = path.resolve(process.env.WERKBANK_ROOT || process.cwd());
const DATA = process.env.WERKBANK_DATA || '_werkbank';

function safe(p) {
  const abs = path.resolve(ROOT, String(p));
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"${p}" is outside the working folder (${ROOT}).`);
  return abs;
}
const readPdf = (p) => { const a = safe(p); if (!fs.existsSync(a)) throw new Error(`File not found: ${p}`); return new Uint8Array(fs.readFileSync(a)); };
const rel = (a) => path.relative(ROOT, a).split(path.sep).join('/');
function freeName(file, suffix, out) {
  if (out) { const a = safe(out); if (fs.existsSync(a)) throw new Error(`"${out}" already exists. Choose another name – existing files are never overwritten.`); return a; }
  const base = safe(file).replace(/\.pdf$/i, '');
  let n = 0, cand;
  do { cand = `${base}_${suffix}${n ? '_' + (n + 1) : ''}.pdf`; n++; } while (fs.existsSync(cand));
  return cand;
}
function write(a, bytes) { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, bytes); return rel(a); }

const FILE = { type: 'string', description: 'Path of the PDF (relative to the working folder)' };
const OUT = { type: 'string', description: 'Optional: name of the new file. Default: next to the original with a suffix. Existing files are never overwritten.' };
const PAGES = { description: 'Pages, e.g. "1-3,5" or [1,2]. Counting starts at 1. Omit = all pages.' };
const kindsList = Object.entries(KINDS).map(([k, v]) => `${k} (${v.label})`).join('; ');

const TOOLS = [
  { name: 'pdf_info', description: 'Page count, title/author, page sizes, whether the PDF is encrypted and which pages have no text (scans; use pdf_ocr for those).', inputSchema: { type: 'object', properties: { file: FILE }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), r = await info(b); try { r.pages_without_text = (await detectScanned(b)).filter((s) => s.scanned).map((s) => s.page); } catch { /* optional */ } return r; } },
  { name: 'pdf_read_text', description: 'Reads the text of the PDF page by page. Pages without text (scanned images) are empty and carry a hint pointing to pdf_ocr.', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES }, required: ['file'] },
    run: async (a) => (await readText(readPdf(a.file), a.pages)).map((p) => (p.text ? p : { ...p, note: 'No text on this page. Probably a scan: run pdf_ocr to recognize the text.' })) },
  { name: 'pdf_ocr', description: 'Text recognition (OCR) for scanned pages, fully local and offline. Creates a new PDF: the image stays unchanged, the recognized text sits invisibly and exactly placed behind it (searchable, selectable, redactable). Detects rotated pages by itself. Default: all pages without text. Takes about 10–25 seconds per page (quality "fast" about half). Handwriting and formulas are not recognized reliably: tell the user about pages with low confidence (low_confidence).', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, languages: { type: 'array', items: { type: 'string', enum: ['deu', 'eng'] }, description: 'Languages, default ["deu","eng"]' }, quality: { type: 'string', enum: ['good', 'fast'], description: 'good = 300 dpi with an extra pass for tables/forms (default), fast = 250 dpi, no extra pass' }, force: { type: 'boolean', description: 'Also process pages that already have text (text is added, nothing is replaced). Usually not needed.' }, out: OUT }, required: ['file'] },
    run: async (a) => {
      const b = readPdf(a.file);
      const pages = a.pages ? parsePages(a.pages, (await info(b)).pages).map((i) => i + 1) : null;
      const r = await ocrPdf(b, { pages, langs: a.languages, force: !!a.force, fast: a.quality === 'fast' });
      if (!r.bytes) return { changed: false, note: r.message, skipped: r.skipped };
      return { file: write(freeName(a.file, 'ocr', a.out), r.bytes), pages: r.pages.map((p) => ({ page: p.page, words: p.words, confidence: p.conf, turned_by: p.turned, low_confidence: p.lowConf })), skipped_pages_with_text: r.skipped };
    } },
  { name: 'pdf_read_marks', description: 'Reads the highlights and comments of the user from the Werkbank viewer (marks.md). This tells you which passages the user means.', inputSchema: { type: 'object', properties: { file: FILE }, required: ['file'] },
    run: async (a) => {
      const p = path.join(safe(a.file).replace(/\.pdf$/i, '').replace(ROOT, path.join(ROOT, DATA)), 'marks.md');
      return fs.existsSync(p) ? { marks: fs.readFileSync(p, 'utf8') } : { marks: null, note: 'No markings yet.' };
    } },
  { name: 'pdf_find', description: 'Searches the PDF without changing anything. "kinds" detects typical personal data. Use this before redacting and check the matches. Only you can recognize names and addresses: read the text and pass them to pdf_redact as "terms". Detectable kinds: ' + kindsList,
    inputSchema: { type: 'object', properties: { file: FILE, terms: { type: 'array', items: { type: 'string' }, description: 'Fixed terms (case and whitespace are ignored)' }, regex: { type: 'array', items: { type: 'string' } }, kinds: { type: 'array', items: { type: 'string', enum: Object.keys(KINDS) } }, pages: PAGES }, required: ['file'] },
    run: async (a) => { const h = await find(readPdf(a.file), a); return { count: h.length, hits: h }; } },
  { name: 'pdf_redact', description: 'TRUE redaction with preserved structure. The characters under the bar are deleted directly from the page code (not just covered); fonts, layout, links, bookmarks and forms stay as in the original. Only when that is not safe (e.g. a photo or graphic under the bar) is that page rebuilt as an image with an exact text layer; this is reported in the result under "seiten". Afterwards the tool also checks the new file for leftovers in properties, bookmarks and metadata and cleans them if needed. Form fields under a bar are cleared. Scanned pages without text have nothing to search (run pdf_ocr first) and can only be redacted via "boxes" (areas). With dry_run=true it only shows what would be hit. Always run dry_run or pdf_find first, then show the user the list of matches.',
    inputSchema: { type: 'object', properties: { file: FILE, out: OUT, terms: { type: 'array', items: { type: 'string' } }, regex: { type: 'array', items: { type: 'string' } }, kinds: { type: 'array', items: { type: 'string', enum: Object.keys(KINDS) } }, boxes: { type: 'array', description: 'Areas as fractions of the page (0–1, from the top left)', items: { type: 'object', properties: { page: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['page', 'x', 'y', 'w', 'h'] } }, pages: PAGES, dry_run: { type: 'boolean' } }, required: ['file'] },
    run: async (a) => {
      const bytes = readPdf(a.file);
      if (a.dry_run) {
        const r = await redact(bytes, a);
        return { dry_run: true, would_redact: r.found, pages: r.pagesChanged, note: r.found.length ? undefined : 'Nothing found – nothing was changed.' };
      }
      const r = await redactVerified(bytes, a);
      if (!r.bytes) return { note: 'Nothing found – nothing was changed.' };
      const saved = write(freeName(a.file, 'redacted', a.out), r.bytes);
      const v = r.verification;
      return { file: saved, redacted_count: r.found.length, pages: r.pagesChanged, found: r.found, page_modes: r.modes, verification: v.ok ? { ok: true, note: 'Verified: no redacted text remains in page content, data streams, properties or bookmarks.', gesaeubert: v.scrubbed.length ? v.scrubbed : undefined } : { ok: false, remaining: v.remaining, warnung: 'Leftovers remain in the file! Do not share it.' } };
    } },
  { name: 'pdf_merge', description: 'Merges several PDFs in the given order.', inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, out: { type: 'string', description: 'Name of the new file (required)' } }, required: ['files', 'out'] },
    run: async (a) => ({ file: write(freeName(a.files[0], 'x', a.out), await ops.merge(a.files.map(readPdf))) }) },
  { name: 'pdf_split', description: 'Splits a PDF into several files: by ranges ("1-3,5,7-") or every N pages.', inputSchema: { type: 'object', properties: { file: FILE, ranges: { type: 'string' }, every: { type: 'number' } }, required: ['file'] },
    run: async (a) => {
      const parts = await ops.split(readPdf(a.file), a.every ? { every: a.every } : { ranges: a.ranges });
      return { files: parts.map((p) => write(freeName(a.file, p.label), p.bytes)) };
    } },
  { name: 'pdf_extract_pages', description: 'Creates a new PDF with only the listed pages (in the listed order, repeats allowed).', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, out: OUT }, required: ['file', 'pages'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'extract', a.out), await ops.reorder(b, parsePages(a.pages, n))) }; } },
  { name: 'pdf_delete_pages', description: 'Removes pages (result is a new file).', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, out: OUT }, required: ['file', 'pages'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'trimmed', a.out), await ops.remove(b, parsePages(a.pages, n))) }; } },
  { name: 'pdf_rotate', description: 'Rotates pages by 90, 180 or 270 degrees clockwise.', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, degrees: { type: 'number', enum: [90, 180, 270] }, out: OUT }, required: ['file', 'degrees'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'rotated', a.out), await ops.rotate(b, parsePages(a.pages, n), a.degrees)) }; } },
  { name: 'pdf_reorder', description: 'Reorders the pages: "order" lists the old page numbers in the new order, e.g. [3,1,2].', inputSchema: { type: 'object', properties: { file: FILE, order: { type: 'array', items: { type: 'number' } }, out: OUT }, required: ['file', 'order'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'umsortiert', a.out), await ops.reorder(b, parsePages(a.order, n))) }; } },
  { name: 'pdf_crop', description: 'Trims margins (in millimeters, relative to the displayed page).', inputSchema: { type: 'object', properties: { file: FILE, top_mm: { type: 'number' }, right_mm: { type: 'number' }, bottom_mm: { type: 'number' }, left_mm: { type: 'number' }, pages: PAGES, out: OUT }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b), k = 2.835; return { file: write(freeName(a.file, 'zugeschnitten', a.out), await ops.crop(b, { top: (a.top_mm || 0) * k, right: (a.right_mm || 0) * k, bottom: (a.bottom_mm || 0) * k, left: (a.left_mm || 0) * k }, parsePages(a.pages, n))) }; } },
  { name: 'pdf_number_pages', description: 'Adds page numbers. format: {n} = page, {N} = total, e.g. "Page {n} of {N}". pos: top-left|top-center|top-right|bottom-left|bottom-center|bottom-right.', inputSchema: { type: 'object', properties: { file: FILE, format: { type: 'string' }, pos: { type: 'string' }, start: { type: 'number' }, out: OUT }, required: ['file'] },
    run: async (a) => ({ file: write(freeName(a.file, 'nummeriert', a.out), await ops.numberPages(readPdf(a.file), { format: a.format || '{n}', pos: a.pos || 'bottom-center', start: a.start || 1 })) }) },
  { name: 'pdf_compress', description: 'Light size reduction (rewrites the structure, removes metadata). Mostly helps with large files carrying legacy baggage.', inputSchema: { type: 'object', properties: { file: FILE, out: OUT }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), o = await ops.optimize(b); if (o.length >= b.length) return { changed: false, note: 'No savings possible – nothing written.' }; return { file: write(freeName(a.file, 'compressed', a.out), o), before: b.length, after: o.length }; } }
];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const INSTRUCTIONS = 'Tools for PDF files. Work carefully: originals stay unchanged, results are new files. When redacting, always search/dry_run first, show the matches to the user and redact only after their approval. Scanned pages (pdf_info: pages_without_text) have no text: run pdf_ocr first, then search/read/redact. Signing and sending is done by the user.';

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'werkbank', version: '0.8.0' }, instructions: INSTRUCTIONS } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const t = byName.get(params?.name);
      if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      try {
        const r = await t.run(params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Error: ' + (e.message || e) }] } });
      }
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not supported: ' + method } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } }); }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch { /* ignore invalid line */ } } } });
