// Reine PDF-Funktionen (ohne Oberfläche). Läuft in VS Code, im Browser und in Node.
// Alle Seitenindizes sind 0-basiert. Eingabe und Ausgabe: Uint8Array.
import { PDFDocument, StandardFonts, rgb, degrees } from './lib/pdf-lib.esm.min.js';

const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
const save = (doc) => doc.save({ useObjectStreams: true });

export async function pageCount(bytes) { return (await load(bytes)).getPageCount(); }

export async function rotate(bytes, idxs, delta) {
  const doc = await load(bytes), pages = doc.getPages();
  for (const i of idxs) { const p = pages[i]; if (p) p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360)); }
  return save(doc);
}

export async function remove(bytes, idxs) {
  const doc = await load(bytes);
  if (idxs.length >= doc.getPageCount()) throw new Error('Es muss mindestens eine Seite übrig bleiben.');
  [...new Set(idxs)].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return save(doc);
}

/** order[neu] = alt. Doppelte Einträge duplizieren die Seite. Auch zum Extrahieren. */
/** Übernimmt Titel, Autor, Thema und Stichwörter in ein neu erzeugtes Dokument. */
function carryMeta(src, out) {
  const t = src.getTitle(), a = src.getAuthor(), s = src.getSubject(), k = src.getKeywords();
  if (t) out.setTitle(t); if (a) out.setAuthor(a); if (s) out.setSubject(s); if (k) out.setKeywords([k]);
}

export async function reorder(bytes, order) {
  const src = await load(bytes), out = await PDFDocument.create();
  carryMeta(src, out);
  const pages = await out.copyPages(src, order);
  pages.forEach((p) => out.addPage(p));
  return save(out);
}
export const extract = reorder;

/** Fügt alle Seiten (oder otherIdxs) von other hinter Position `at` (0..n) ein. */
export async function insert(bytes, other, at, otherIdxs) {
  const doc = await load(bytes), src = await load(other);
  const idxs = otherIdxs || src.getPageIndices();
  const copied = await doc.copyPages(src, idxs);
  copied.forEach((p, k) => doc.insertPage(at + k, p));
  return save(doc);
}

export async function merge(list) {
  const out = await PDFDocument.create();
  for (const [i, b] of list.entries()) { const src = await load(b); if (i === 0) carryMeta(src, out); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
  return save(out);
}

/** "1-3, 5, 7-" -> [[0,2],[4,4],[6,n-1]]; wirft bei Fehlern */
export function parseRanges(str, n) {
  const out = [];
  for (const part of String(str).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`„${part}“ ist kein gültiger Bereich (Beispiel: 1-3, 5, 7-9).`);
    let a = m[1] === '' ? 1 : +m[1], b = m.length === 2 ? a : (m[2] === '' ? n : +m[2]);
    if (a < 1 || b < a || b > n) throw new Error(`Bereich „${part}“ liegt außerhalb von 1–${n}.`);
    out.push([a - 1, b - 1]);
  }
  if (!out.length) throw new Error('Kein Bereich angegeben.');
  return out;
}
export const rangeIdxs = ([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** mode: {ranges:"1-3,5"} oder {every:N} -> [{label, bytes}] */
export async function split(bytes, mode) {
  const n = await pageCount(bytes), ranges = [];
  if (mode.every) for (let a = 0; a < n; a += mode.every) ranges.push([a, Math.min(n - 1, a + mode.every - 1)]);
  else ranges.push(...parseRanges(mode.ranges, n));
  const out = [];
  for (const r of ranges) out.push({ label: r[0] === r[1] ? `S${r[0] + 1}` : `S${r[0] + 1}-${r[1] + 1}`, bytes: await reorder(bytes, rangeIdxs(r)) });
  return out;
}

/** Ränder in Punkt (1 mm = 2,835 pt), bezogen auf die angezeigte (ggf. gedrehte) Seite. */
export async function crop(bytes, { top = 0, right = 0, bottom = 0, left = 0 }, idxs) {
  const doc = await load(bytes), pages = doc.getPages();
  (idxs || pages.map((_, i) => i)).forEach((i) => {
    const p = pages[i]; if (!p) return;
    const r = ((p.getRotation().angle % 360) + 360) % 360, b = p.getCropBox() || p.getMediaBox();
    // Ränder der Anzeige auf ungedrehte PDF-Koordinaten abbilden
    const m = r === 0 ? { l: left, r: right, t: top, b: bottom }
      : r === 90 ? { l: bottom, r: top, t: left, b: right }
      : r === 180 ? { l: right, r: left, t: bottom, b: top }
      : { l: top, r: bottom, t: right, b: left };
    const w = b.width - m.l - m.r, h = b.height - m.t - m.b;
    if (w < 20 || h < 20) throw new Error('Die Ränder sind zu groß für die Seite.');
    p.setCropBox(b.x + m.l, b.y + m.b, w, h);
  });
  return save(doc);
}

const POS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const NUMBER_POSITIONS = POS;
export async function numberPages(bytes, { format = '{n}', pos = 'bottom-center', size = 10, margin = 24, start = 1 } = {}) {
  const doc = await load(bytes), font = await doc.embedFont(StandardFonts.Helvetica), pages = doc.getPages(), N = pages.length;
  pages.forEach((p, i) => {
    const text = format.replace(/\{n\}/g, String(start + i)).replace(/\{N\}/g, String(N + start - 1)).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
    const b = p.getCropBox() || p.getMediaBox(), w = font.widthOfTextAtSize(text, size);
    const r = ((p.getRotation().angle % 360) + 360) % 360;
    // Zielpunkt in der Anzeige (u,v in pt von links/oben) -> PDF-Koordinaten
    const dw = r % 180 ? b.height : b.width, dh = r % 180 ? b.width : b.height;
    const [vert, hor] = pos.split('-');
    const du = hor === 'left' ? margin : hor === 'right' ? dw - margin - w : (dw - w) / 2;
    const dv = vert === 'top' ? margin + size * 0.8 : dh - margin;
    const [px, py] = toPdf(du / dw, dv / dh, b.width, b.height, r);
    p.drawText(text, { x: b.x + px, y: b.y + py, size, font, color: rgb(0.15, 0.15, 0.15), rotate: degrees(r) });
  });
  return save(doc);
}

/** Ersetzt jede Seite durch ein Bild (für starkes Komprimieren und Schwärzen).
 *  items: [{ index, jpeg|png: Uint8Array, width, height (Seitengröße in pt) }] – übrige Seiten bleiben unverändert. */
export async function replaceWithImages(bytes, items) {
  const doc = await load(bytes);
  for (const it of items) {
    const old = doc.getPage(it.index), rot = old.getRotation();
    const img = it.png ? await doc.embedPng(it.png) : await doc.embedJpg(it.jpeg);
    const page = doc.insertPage(it.index, [it.width, it.height]);
    page.drawImage(img, { x: 0, y: 0, width: it.width, height: it.height });
    doc.removePage(it.index + 1);
    void rot; // das Bild ist schon so gerendert, wie die Seite angezeigt wird
  }
  return save(doc);
}

/** Leichtes Komprimieren: Struktur neu schreiben, Metadaten und unbenutzte Objekte weglassen. */
export async function optimize(bytes) {
  const doc = await load(bytes);
  doc.setTitle(doc.getTitle() || ''); doc.setProducer(''); doc.setCreator('');
  return save(doc);
}

// ------------------------------------------------------------------ Markierungen mitführen
const clone = (o) => JSON.parse(JSON.stringify(o));
const nid = () => Math.random().toString(36).slice(2, 10);

/** order[neu] = alt (0-basiert). Gibt neue ann zurück; Duplikate bekommen neue IDs. */
export function annReorder(ann, order) {
  const out = {}, used = new Set();
  order.forEach((old, i) => {
    const a = ann[old + 1]; if (!a) return;
    const c = clone(a);
    if (used.has(old)) for (const k of ['hl', 'ink', 'notes', 'sigs']) (c[k] || []).forEach((x) => (x.id = nid()));
    used.add(old); out[i + 1] = c;
  });
  return out;
}

/** Punkt (u,v) in Anzeige-Koordinaten (0..1) nach Drehung um delta Grad im Uhrzeigersinn. */
export function rotPoint([u, v], delta) {
  const d = ((delta % 360) + 360) % 360;
  return d === 90 ? [1 - v, u] : d === 180 ? [1 - u, 1 - v] : d === 270 ? [v, 1 - u] : [u, v];
}
export function rotRect([x, y, w, h], delta) {
  const a = rotPoint([x, y], delta), b = rotPoint([x + w, y + h], delta);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
}
export function annRotate(ann, idxs, delta) {
  for (const i of idxs) {
    const a = ann[i + 1]; if (!a) continue;
    (a.hl || []).forEach((h) => (h.rects = h.rects.map((r) => rotRect(r, delta))));
    (a.ink || []).forEach((s) => (s.pts = s.pts.map((p) => rotPoint(p, delta))));
    (a.notes || []).forEach((n) => { const p = rotPoint([n.x, n.y], delta); n.x = p[0]; n.y = p[1]; });
    (a.sigs || []).forEach((s) => { const r = rotRect([s.x, s.y, s.w, s.h], delta); [s.x, s.y, s.w, s.h] = r; });
  }
  return ann;
}

/** Normalisierte Anzeige-Koordinaten -> PDF-Koordinaten (Punkt) für eine Seite mit Drehung r. */
export function toPdf(u, v, W, H, r) {
  r = ((r % 360) + 360) % 360;
  return r === 90 ? [v * W, u * H] : r === 180 ? [(1 - u) * W, v * H] : r === 270 ? [(1 - v) * W, (1 - u) * H] : [u * W, H - v * H];
}
