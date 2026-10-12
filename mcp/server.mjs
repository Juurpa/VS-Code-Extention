#!/usr/bin/env node
// Werkbank-MCP-Server: gibt einer KI (z. B. Claude Code) die PDF-Werkzeuge der Werkbank.
// Läuft lokal über stdin/stdout. Dateien nur innerhalb des Arbeitsordners (WERKBANK_ROOT, sonst aktuelles Verzeichnis).
// Originale werden nie überschrieben: Ergebnisse landen in neuen Dateien neben dem Original.
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
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`„${p}“ liegt außerhalb des Arbeitsordners (${ROOT}).`);
  return abs;
}
const readPdf = (p) => { const a = safe(p); if (!fs.existsSync(a)) throw new Error(`Datei nicht gefunden: ${p}`); return new Uint8Array(fs.readFileSync(a)); };
const rel = (a) => path.relative(ROOT, a).split(path.sep).join('/');
function freeName(file, suffix, out) {
  if (out) { const a = safe(out); if (fs.existsSync(a)) throw new Error(`„${out}“ gibt es schon. Anderen Namen wählen – vorhandene Dateien werden nicht überschrieben.`); return a; }
  const base = safe(file).replace(/\.pdf$/i, '');
  let n = 0, cand;
  do { cand = `${base}_${suffix}${n ? '_' + (n + 1) : ''}.pdf`; n++; } while (fs.existsSync(cand));
  return cand;
}
function write(a, bytes) { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, bytes); return rel(a); }

const FILE = { type: 'string', description: 'Pfad der PDF (relativ zum Arbeitsordner)' };
const OUT = { type: 'string', description: 'Optional: Name der neuen Datei. Standard: neben dem Original mit Endung. Bestehende Dateien werden nie überschrieben.' };
const PAGES = { description: 'Seiten, z. B. "1-3,5" oder [1,2]. Zählung ab 1. Weglassen = alle.' };
const kindsList = Object.entries(KINDS).map(([k, v]) => `${k} (${v.label})`).join('; ');

const TOOLS = [
  { name: 'pdf_info', description: 'Seitenzahl, Titel/Autor, Seitengrößen, ob die PDF verschlüsselt ist und welche Seiten keinen Text haben (Scans, dafür pdf_ocr).', inputSchema: { type: 'object', properties: { file: FILE }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), r = await info(b); try { r.seiten_ohne_text = (await detectScanned(b)).filter((s) => s.scanned).map((s) => s.page); } catch { /* optional */ } return r; } },
  { name: 'pdf_read_text', description: 'Liest den Text der PDF seitenweise. Seiten ohne Text (eingescannte Bilder) sind leer und tragen dann einen Hinweis auf pdf_ocr.', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES }, required: ['file'] },
    run: async (a) => (await readText(readPdf(a.file), a.pages)).map((p) => (p.text ? p : { ...p, hinweis: 'Kein Text auf dieser Seite. Vermutlich ein Scan: mit pdf_ocr Text erkennen lassen.' })) },
  { name: 'pdf_ocr', description: 'Texterkennung (OCR) für eingescannte Seiten, vollständig lokal und ohne Internet. Legt eine neue PDF an: Das Bild bleibt unverändert, der erkannte Text liegt unsichtbar und exakt platziert dahinter (durchsuchbar, markierbar, schwärzbar). Erkennt gedrehte Seiten selbst. Standard: alle Seiten ohne Text. Dauert je Seite etwa 10–25 Sekunden (quality "fast" etwa die Hälfte). Handschrift und Formeln werden nicht zuverlässig erkannt: Seiten mit niedriger Sicherheit (low_confidence) dem Nutzer nennen.', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, languages: { type: 'array', items: { type: 'string', enum: ['deu', 'eng'] }, description: 'Sprachen, Standard ["deu","eng"]' }, quality: { type: 'string', enum: ['good', 'fast'], description: 'good = 300 dpi mit Zusatzdurchgang für Tabellen/Formulare (Standard), fast = 250 dpi, ohne Zusatzdurchgang' }, force: { type: 'boolean', description: 'Auch Seiten behandeln, die schon Text haben (dort wird Text ergänzt, nichts ersetzt). Meist nicht nötig.' }, out: OUT }, required: ['file'] },
    run: async (a) => {
      const b = readPdf(a.file);
      const pages = a.pages ? parsePages(a.pages, (await info(b)).pages).map((i) => i + 1) : null;
      const r = await ocrPdf(b, { pages, langs: a.languages, force: !!a.force, fast: a.quality === 'fast' });
      if (!r.bytes) return { changed: false, hinweis: r.message, uebersprungen: r.skipped };
      return { file: write(freeName(a.file, 'ocr', a.out), r.bytes), pages: r.pages.map((p) => ({ page: p.page, words: p.words, confidence: p.conf, turned_by: p.turned, low_confidence: p.lowConf })), skipped_pages_with_text: r.skipped };
    } },
  { name: 'pdf_read_marks', description: 'Liest die Markierungen und Kommentare des Nutzers aus dem Werkbank-Betrachter (markierungen.md). Damit weißt du, welche Stellen der Nutzer gemeint hat.', inputSchema: { type: 'object', properties: { file: FILE }, required: ['file'] },
    run: async (a) => {
      const p = path.join(safe(a.file).replace(/\.pdf$/i, '').replace(ROOT, path.join(ROOT, DATA)), 'markierungen.md');
      return fs.existsSync(p) ? { marks: fs.readFileSync(p, 'utf8') } : { marks: null, hinweis: 'Noch keine Markierungen vorhanden.' };
    } },
  { name: 'pdf_find', description: 'Sucht in der PDF, ohne etwas zu verändern. Mit "kinds" werden typische persönliche Angaben erkannt. Nutze das, bevor du schwärzt, und prüfe die Treffer. Namen und Adressen erkennt nur du selbst: lies den Text und gib sie dann bei pdf_redact als "terms" an. Erkennbare Arten: ' + kindsList,
    inputSchema: { type: 'object', properties: { file: FILE, terms: { type: 'array', items: { type: 'string' }, description: 'Feste Begriffe (Groß/Kleinschreibung und Leerzeichen egal)' }, regex: { type: 'array', items: { type: 'string' } }, kinds: { type: 'array', items: { type: 'string', enum: Object.keys(KINDS) } }, pages: PAGES }, required: ['file'] },
    run: async (a) => { const h = await find(readPdf(a.file), a); return { count: h.length, hits: h }; } },
  { name: 'pdf_redact', description: 'ECHTES Schwärzen bei erhaltener Struktur. Die Buchstaben unter dem Balken werden direkt aus dem Seitencode gelöscht (nicht nur überdeckt); Schrift, Layout, Links, Lesezeichen und Formulare bleiben wie im Original. Nur wenn das nicht sicher geht (z. B. ein Foto oder eine Grafik unter dem Balken), wird diese Seite als Bild mit exaktem Textlayer neu aufgebaut; das steht dann im Ergebnis unter "seiten". Danach prüft das Werkzeug die neue Datei auch in Eigenschaften, Lesezeichen und Metadaten auf Reste und säubert sie bei Bedarf. Formularfelder unter einem Balken werden geleert. Gescannte Seiten ohne Text haben keinen Text zum Finden (dafür fehlt noch OCR) und lassen sich nur über "boxes" (Bereiche) schwärzen. Mit dry_run=true wird nur gezeigt, was getroffen würde. Immer zuerst dry_run oder pdf_find, dann dem Nutzer die Trefferliste zeigen.',
    inputSchema: { type: 'object', properties: { file: FILE, out: OUT, terms: { type: 'array', items: { type: 'string' } }, regex: { type: 'array', items: { type: 'string' } }, kinds: { type: 'array', items: { type: 'string', enum: Object.keys(KINDS) } }, boxes: { type: 'array', description: 'Bereiche in Anteilen der Seite (0–1, von links oben)', items: { type: 'object', properties: { page: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['page', 'x', 'y', 'w', 'h'] } }, pages: PAGES, dry_run: { type: 'boolean' } }, required: ['file'] },
    run: async (a) => {
      const bytes = readPdf(a.file);
      if (a.dry_run) {
        const r = await redact(bytes, a);
        return { dry_run: true, would_redact: r.found, pages: r.pagesChanged, hinweis: r.found.length ? undefined : 'Nichts gefunden – es wurde nichts geändert.' };
      }
      const r = await redactVerified(bytes, a);
      if (!r.bytes) return { hinweis: 'Nichts gefunden – es wurde nichts geändert.' };
      const saved = write(freeName(a.file, 'geschwaerzt', a.out), r.bytes);
      const v = r.verification;
      return { file: saved, redacted_count: r.found.length, pages: r.pagesChanged, found: r.found, seiten: r.modes, verification: v.ok ? { ok: true, hinweis: 'Geprüft: kein geschwärzter Text mehr in Seiteninhalt, Datenströmen, Eigenschaften oder Lesezeichen.', gesaeubert: v.scrubbed.length ? v.scrubbed : undefined } : { ok: false, remaining: v.remaining, warnung: 'In der Datei sind noch Reste! Nicht weitergeben.' } };
    } },
  { name: 'pdf_merge', description: 'Fügt mehrere PDFs in der angegebenen Reihenfolge zusammen.', inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, out: { type: 'string', description: 'Name der neuen Datei (Pflicht)' } }, required: ['files', 'out'] },
    run: async (a) => ({ file: write(freeName(a.files[0], 'x', a.out), await ops.merge(a.files.map(readPdf))) }) },
  { name: 'pdf_split', description: 'Teilt eine PDF in mehrere Dateien: nach Bereichen ("1-3,5,7-") oder alle N Seiten.', inputSchema: { type: 'object', properties: { file: FILE, ranges: { type: 'string' }, every: { type: 'number' } }, required: ['file'] },
    run: async (a) => {
      const parts = await ops.split(readPdf(a.file), a.every ? { every: a.every } : { ranges: a.ranges });
      return { files: parts.map((p) => write(freeName(a.file, p.label), p.bytes)) };
    } },
  { name: 'pdf_extract_pages', description: 'Legt eine neue PDF nur mit den genannten Seiten an (in genannter Reihenfolge, Wiederholungen erlaubt).', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, out: OUT }, required: ['file', 'pages'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'auszug', a.out), await ops.reorder(b, parsePages(a.pages, n))) }; } },
  { name: 'pdf_delete_pages', description: 'Entfernt Seiten (Ergebnis als neue Datei).', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, out: OUT }, required: ['file', 'pages'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'gekuerzt', a.out), await ops.remove(b, parsePages(a.pages, n))) }; } },
  { name: 'pdf_rotate', description: 'Dreht Seiten um 90, 180 oder 270 Grad im Uhrzeigersinn.', inputSchema: { type: 'object', properties: { file: FILE, pages: PAGES, degrees: { type: 'number', enum: [90, 180, 270] }, out: OUT }, required: ['file', 'degrees'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'gedreht', a.out), await ops.rotate(b, parsePages(a.pages, n), a.degrees)) }; } },
  { name: 'pdf_reorder', description: 'Ordnet die Seiten neu: "order" nennt die alten Seitenzahlen in neuer Reihenfolge, z. B. [3,1,2].', inputSchema: { type: 'object', properties: { file: FILE, order: { type: 'array', items: { type: 'number' } }, out: OUT }, required: ['file', 'order'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b); return { file: write(freeName(a.file, 'umsortiert', a.out), await ops.reorder(b, parsePages(a.order, n))) }; } },
  { name: 'pdf_crop', description: 'Schneidet Ränder ab (in Millimetern, bezogen auf die angezeigte Seite).', inputSchema: { type: 'object', properties: { file: FILE, top_mm: { type: 'number' }, right_mm: { type: 'number' }, bottom_mm: { type: 'number' }, left_mm: { type: 'number' }, pages: PAGES, out: OUT }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), n = await ops.pageCount(b), k = 2.835; return { file: write(freeName(a.file, 'zugeschnitten', a.out), await ops.crop(b, { top: (a.top_mm || 0) * k, right: (a.right_mm || 0) * k, bottom: (a.bottom_mm || 0) * k, left: (a.left_mm || 0) * k }, parsePages(a.pages, n))) }; } },
  { name: 'pdf_number_pages', description: 'Setzt Seitenzahlen. format: {n} = Seite, {N} = Gesamtzahl, z. B. "Seite {n} von {N}". pos: top-left|top-center|top-right|bottom-left|bottom-center|bottom-right.', inputSchema: { type: 'object', properties: { file: FILE, format: { type: 'string' }, pos: { type: 'string' }, start: { type: 'number' }, out: OUT }, required: ['file'] },
    run: async (a) => ({ file: write(freeName(a.file, 'nummeriert', a.out), await ops.numberPages(readPdf(a.file), { format: a.format || '{n}', pos: a.pos || 'bottom-center', start: a.start || 1 })) }) },
  { name: 'pdf_compress', description: 'Leichtes Verkleinern (Struktur neu schreiben, Metadaten entfernen). Wirkt vor allem bei großen Dateien mit Altlasten.', inputSchema: { type: 'object', properties: { file: FILE, out: OUT }, required: ['file'] },
    run: async (a) => { const b = readPdf(a.file), o = await ops.optimize(b); if (o.length >= b.length) return { changed: false, hinweis: 'Keine Ersparnis möglich – nichts geschrieben.' }; return { file: write(freeName(a.file, 'klein', a.out), o), before: b.length, after: o.length }; } }
];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const INSTRUCTIONS = 'Werkzeuge für PDF-Dateien. Arbeite vorsichtig: Originale bleiben unverändert, Ergebnisse sind neue Dateien. Beim Schwärzen immer zuerst suchen/dry_run, die Treffer dem Nutzer zeigen und erst nach seiner Zustimmung schwärzen. Eingescannte Seiten (pdf_info: seiten_ohne_text) haben keinen Text: erst pdf_ocr, dann suchen/lesen/schwärzen. Unterschreiben und Absenden macht der Nutzer selbst.';

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // Benachrichtigung
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'werkbank', version: '0.7.5' }, instructions: INSTRUCTIONS } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const t = byName.get(params?.name);
      if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unbekanntes Werkzeug: ${params?.name}` } });
      try {
        const r = await t.run(params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Fehler: ' + (e.message || e) }] } });
      }
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Methode nicht unterstützt: ' + method } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } }); }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch { /* ungültige Zeile ignorieren */ } } } });
