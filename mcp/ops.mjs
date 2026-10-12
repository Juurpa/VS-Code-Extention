// Die Werkzeuge der KI-Schnittstelle: reine Funktionen auf Bytes, ohne MCP-Teil.
import zlib from 'node:zlib';
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFDict, PDFArray, PDFString, PDFHexString, PDFName, PDFRef } from '../media/lib/pdf-lib.esm.min.js';
import fontkit from '@pdf-lib/fontkit';
import { overlaps } from './textlayer.mjs';
import { applyRedactions, checkVectorPages } from './vredact.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import * as ops from '../media/pdfops.js';
import { openPdf, pageChars, findMatches, renderPage, blackout, encodePng, lineBars } from './pdftext.mjs';

export { ops };

export const KINDS = {
  iban: { re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, label: 'IBAN' },
  email: { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, label: 'E-Mail-Adresse' },
  telefon: { re: /(?:\+49|0049|\b0)[\s\d\/()-]{6,}\d/g, label: 'Telefonnummer (kann auch andere Zahlen treffen)' },
  datum: { re: /\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g, label: 'Datum (z. B. Geburtsdatum)' },
  plz_ort: { re: /\b\d{5}\s+[A-ZÄÖÜ][\wäöüß-]+/g, label: 'PLZ und Ort' },
  url: { re: /https?:\/\/\S+|www\.\S+/g, label: 'Internetadresse' },
  elfstellig: { re: /\b\d{11}\b/g, label: 'elfstellige Nummer (z. B. Steuer-ID)' },
  kreditkarte: { re: /\b(?:\d[ -]?){13,19}\b/g, label: 'Kartennummer', ok: (s) => luhn(s.replace(/\D/g, '')) },
};
function luhn(d) { if (d.length < 13) return false; let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fester Text -> Regex, der Groß/Kleinschreibung und beliebige Leerzeichen/Umbrüche zwischen Zeichen ignoriert. */
export function termRegex(t) {
  const chars = [...String(t)].filter((c) => !/\s/.test(c));
  if (!chars.length) throw new Error('Leerer Suchbegriff.');
  return new RegExp(chars.map(esc).join('\\s*'), 'gi');
}

function parsePages(spec, n) {
  if (!spec || spec === 'all') return Array.from({ length: n }, (_, i) => i);
  if (Array.isArray(spec)) return spec.map((p) => { if (p < 1 || p > n) throw new Error(`Seite ${p} gibt es nicht (1–${n}).`); return p - 1; });
  const set = new Set();
  for (const [a, b] of ops.parseRanges(String(spec), n)) for (let i = a; i <= b; i++) set.add(i);
  return [...set];
}
export { parsePages };

export async function info(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  return {
    pages: pages.length, title: doc.getTitle() || null, author: doc.getAuthor() || null, creator: doc.getCreator() || null, producer: doc.getProducer() || null,
    encrypted: doc.isEncrypted,
    sizes: pages.slice(0, 50).map((p, i) => ({ page: i + 1, width_pt: Math.round(p.getWidth()), height_pt: Math.round(p.getHeight()), rotation: p.getRotation().angle }))
  };
}

export async function readText(bytes, pagesSpec) {
  const pdf = await openPdf(bytes);
  try {
    const out = [];
    for (const i of parsePages(pagesSpec, pdf.count)) {
      const page = pdf.doc.getPage(i);
      let t = ''; try { t = pageChars(pdf.lib, page, 1).text; } catch { /* leer */ }
      out.push({ page: i + 1, text: t.replace(/\r\n?/g, '\n').trim() });
    }
    return out;
  } finally { pdf.close(); }
}

function buildMatchers({ terms = [], regex = [], kinds = [] }) {
  const m = [];
  for (const t of terms) m.push({ kind: 'begriff', re: termRegex(t) });
  for (const r of regex) m.push({ kind: 'regex', re: new RegExp(r, 'g') });
  for (const k of kinds) { const d = KINDS[k]; if (!d) throw new Error(`Unbekannte Art „${k}“. Möglich: ${Object.keys(KINDS).join(', ')}`); m.push({ kind: k, re: new RegExp(d.re.source, d.re.flags), ok: d.ok }); }
  return m;
}

/** Sucht Treffer (ohne etwas zu verändern). */
export async function find(bytes, spec) {
  const matchers = buildMatchers(spec), pdf = await openPdf(bytes), hits = [];
  try {
    for (const i of parsePages(spec.pages, pdf.count)) {
      let pc; try { pc = pageChars(pdf.lib, pdf.doc.getPage(i), 1); } catch { continue; }
      for (const mt of matchers) for (const h of findMatches(pc, mt.re)) { if (mt.ok && !mt.ok(h.text)) continue; hits.push({ page: i + 1, kind: mt.kind, text: h.text.replace(/\s+/g, ' ') }); }
    }
  } finally { pdf.close(); }
  return hits;
}

/** Echtes Schwärzen: Seiten mit Treffern werden neu als Bild aufgebaut (schwarze Balken eingebrannt, kein Text, keine Reste). */
export async function redact(bytes, spec) {
  const { boxes = [], scale = 2.5 } = spec, matchers = buildMatchers(spec);
  const pdf = await openPdf(bytes), plan = new Map(), found = [];
  try {
    const pageIdx = parsePages(spec.pages, pdf.count);
    for (const i of pageIdx) {
      const page = pdf.doc.getPage(i), rects = [];
      if (matchers.length) {
        let pc; try { pc = pageChars(pdf.lib, page, scale); } catch { pc = null; }
        if (pc) for (const mt of matchers) for (const h of findMatches(pc, mt.re)) {
          if (mt.ok && !mt.ok(h.text)) continue;
          rects.push(...lineBars(h.rects)); found.push({ page: i + 1, kind: mt.kind, text: h.text.replace(/\s+/g, ' ') });
        }
      }
      if (rects.length) plan.set(i, { text: rects, box: [] });
    }
    for (const b of boxes) {
      const i = b.page - 1; if (i < 0 || i >= pdf.count) throw new Error(`Seite ${b.page} gibt es nicht.`);
      const sz = pdf.doc.getPage(i).getSize({ scale }), r = [b.x * sz.width, b.y * sz.height, (b.x + b.w) * sz.width, (b.y + b.h) * sz.height];
      (plan.get(i) || plan.set(i, { text: [], box: [] }).get(i)).box.push(r); found.push({ page: b.page, kind: 'bereich', text: '(Bereich)' });
    }
    if (spec.dry_run || !plan.size) return { bytes: null, found, pagesChanged: [...plan.keys()].map((i) => i + 1) };

    // Balken je Seite (Pixel bei `scale`) und die dadurch entfernten Zeichenfolgen
    const barsByPage = new Map(), removed = [];
    for (const [i, p] of plan) {
      const bars = [...p.text, ...p.box];
      barsByPage.set(i, bars);
      let pc = null; try { pc = pageChars(pdf.lib, pdf.doc.getPage(i), scale); } catch { /* ohne Text */ }
      if (pc) { let rm = ''; for (const c of pc.chars) { if (c.rect && bars.some((b) => overlaps(c.rect, b))) rm += c.ch; else if (c.gen && rm) rm += ' '; else if (rm) { removed.push(rm); rm = ''; } } if (rm) removed.push(rm); }
    }
    // Struktur 1:1: Buchstaben aus dem Seitencode löschen; nur wenn das nicht sicher geht, Seite als Bild (Notlösung)
    let force = new Set(), res;
    for (let round = 0; round < 3; round++) {
      res = await applyRedactions({ bytes, pdfium: pdf, plan: barsByPage, scale, force });
      const chk = await openPdf(res.bytes);
      let bad; try { bad = checkVectorPages(chk, barsByPage, res.modes, scale); } finally { chk.close(); }
      if (!bad.size) break;
      bad.forEach((i) => force.add(i));
    }
    const modes = [...res.modes].map(([i, m]) => ({ page: i + 1, mode: m === 'vektor' ? 'Buchstaben gelöscht, Seite unverändert' : 'als Bild neu aufgebaut', reason: m === 'bild' ? res.reasons.get(i) : undefined }));
    return { bytes: res.bytes, found, pagesChanged: [...plan.keys()].map((i) => i + 1), removed: [...removed, ...res.wiped], modes };
  } finally { pdf.close(); }
}

/** Prüft die fertige Datei: Treffer im Text und in ALLEN Datenströmen (auch entpackt, auch UTF-16). */
export async function verifyGone(bytes, needles, changedPages /* 1-basiert; sonst alle Seiten */, { loose = false } = {}) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
  const pagesText = await readText(bytes);
  const inChanged = (p) => !changedPages || changedPages.includes(p.page);
  const changedText = norm(pagesText.filter(inChanged).map((p) => p.text).join('\n'));
  const otherText = norm(pagesText.filter((p) => !inChanged(p)).map((p) => p.text).join('\n'));
  const hay = [Buffer.from(bytes).toString('latin1')];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const raw = Buffer.from(obj.contents);
      let dec = raw; try { dec = zlib.inflateSync(raw); } catch { /* nicht gepackt */ }
      hay.push(dec.toString('latin1'), dec.toString('utf16le'), dec.toString('utf8'));
    }
  }
  const walkStrings = (obj, acc, seen = new Set()) => {
    if (!obj || seen.has(obj)) return; seen.add(obj);
    if (obj instanceof PDFString || obj instanceof PDFHexString) { try { acc.push(obj.decodeText()); } catch { /* ignorieren */ } try { acc.push(obj.asString()); } catch { /* ignorieren */ } }
    else if (obj instanceof PDFDict) obj.entries().forEach(([, v]) => walkStrings(v, acc, seen));
    else if (obj instanceof PDFArray) obj.asArray().forEach((v) => walkStrings(v, acc, seen));
  };
  const strs = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) walkStrings(obj instanceof PDFRawStream ? obj.dict : obj, strs);
  hay.push(strs.join('\n'));
  const all = norm(hay.join('\n'));
  const leaks = [];
  for (const n of needles) {
    const s = norm(n); if (s.length < 3) continue;
    // Steht derselbe Text legal auf einer nicht geschwärzten Seite, kann die Rohdatenprüfung ihn nicht zuordnen.
    // loose: Text, der nach dem Schwärzen noch lesbar irgendwo steht (z. B. dasselbe Wort an anderer Stelle), ist kein Fund.
    if (loose && (changedText.includes(s) || otherText.includes(s))) continue;
    const elsewhere = otherText.includes(s);
    if ((!elsewhere && all.includes(s)) || changedText.includes(s)) leaks.push(n);
  }
  return leaks;
}

/** Entfernt Zeichenketten in Dokument-Eigenschaften, Lesezeichen, Beschriftungen usw. und XMP-Metadaten, die geschwärzte Texte enthalten. */
export async function scrub(bytes, needles) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
  const ns = needles.map(norm).filter((s) => s.length >= 3);
  const has = (t) => { const x = norm(t); return ns.some((n) => x.includes(n)); };
  const changes = [], seen = new Set();
  const textOf = (v) => { try { return v.decodeText(); } catch { try { return v.asString(); } catch { return ''; } } };
  const isStr = (v) => v instanceof PDFString || v instanceof PDFHexString;
  const blank = PDFString.of('');
  const walk = (obj, where) => {
    if (!obj || seen.has(obj)) return; seen.add(obj);
    const handle = (v, set, label) => { // v: Wert oder Verweis auf Zeichenkette
      const target = v instanceof PDFRef ? doc.context.lookup(v) : v;
      if (isStr(target)) { if (has(textOf(target))) { if (v instanceof PDFRef) doc.context.assign(v, blank); else set(); changes.push(label); } return true; }
      return false;
    };
    if (obj instanceof PDFDict) for (const [k, v] of obj.entries()) { if (!handle(v, () => obj.set(k, blank), `${where}/${k.decodeText()}`)) walk(v, where); }
    else if (obj instanceof PDFArray) obj.asArray().forEach((v, i) => { if (!handle(v, () => obj.set(i, blank), where + '[]')) walk(v, where); });
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const sub = obj.dict.get(PDFName.of('Subtype')), type = obj.dict.get(PDFName.of('Type'));
      if (type === PDFName.of('Metadata') || sub === PDFName.of('XML')) {
        let txt = ''; try { txt = Buffer.from(decodePDFRawStreamBytes(obj)).toString('utf8'); } catch { /* ignorieren */ }
        if (has(txt)) { doc.catalog.delete(PDFName.of('Metadata')); changes.push('XMP-Metadaten'); }
      }
      walk(obj.dict, 'Objekt');
    } else walk(obj, 'Objekt');
  }
  return { bytes: changes.length ? await doc.save({ useObjectStreams: true }) : bytes, changes };
}
const decodePDFRawStreamBytes = (s) => decodePDFRawStream(s).decode();

/** Schwärzen + Prüfen + (falls nötig) Eigenschaften säubern + erneut prüfen. Gemeinsamer Einstieg für Oberfläche und KI. */
export async function redactVerified(bytes, spec) {
  const r = await redact(bytes, spec);
  if (!r.bytes) return r;
  const strict = [...(spec.terms || []), ...r.found.filter((f) => f.kind !== 'bereich').map((f) => f.text)];
  const check = async (b) => [...await verifyGone(b, strict, r.pagesChanged), ...await verifyGone(b, r.removed, r.pagesChanged, { loose: true })];
  let out = r.bytes, leaks = await check(out), scrubbed = [];
  if (leaks.length) {
    const s = await scrub(out, leaks); out = s.bytes; scrubbed = s.changes;
    leaks = await check(out);
  }
  return { ...r, bytes: out, verification: { ok: leaks.length === 0, remaining: leaks, scrubbed } };
}
