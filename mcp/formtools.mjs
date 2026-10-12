// Forms, watermark/stamp and metadata for the AI tool server and the UI.
// Everything works on bytes and returns new bytes; originals are never touched here.
import { PDFDocument, PDFName, PDFRef, PDFNull, PDFDict, PDFHexString, PDFString, StandardFonts, rgb, degrees, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFButton, PDFSignature } from '../media/lib/pdf-lib.esm.min.js';
import { parsePages } from './ops.mjs';

// pdf-lib writes the cross-reference table as one continuous block. After objects were deleted
// (form.flatten) the gaps would produce a broken table, so every missing number becomes a null object.
function fillGaps(doc) {
  const ctx = doc.context; let max = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) max = Math.max(max, ref.objectNumber);
  for (let n = 1; n <= max; n++) { const ref = PDFRef.of(n); if (!ctx.lookup(ref)) ctx.assign(ref, PDFNull); }
}
const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

function typeOf(f) {
  if (f instanceof PDFTextField) return 'text';
  if (f instanceof PDFCheckBox) return 'checkbox';
  if (f instanceof PDFDropdown) return 'dropdown';
  if (f instanceof PDFOptionList) return 'list';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFButton) return 'button';
  if (f instanceof PDFSignature) return 'signature';
  return 'unknown';
}

function describe(doc, f) {
  const t = typeOf(f), o = { name: f.getName(), type: t, read_only: f.isReadOnly(), required: f.isRequired() };
  try {
    if (t === 'text') { o.value = f.getText() ?? ''; const m = f.getMaxLength(); if (m) o.max_length = m; if (f.isMultiline()) o.multiline = true; }
    else if (t === 'checkbox') o.value = f.isChecked();
    else if (t === 'dropdown' || t === 'list') { o.value = f.getSelected(); o.options = f.getOptions(); }
    else if (t === 'radio') { o.value = f.getSelected() ?? null; o.options = f.getOptions(); }
  } catch { /* leave value out */ }
  try {
    const pages = doc.getPages(), w = f.acroField.getWidgets()[0], pr = w && w.P();
    const idx = pr ? pages.findIndex((p) => p.ref === pr) : -1;
    if (idx >= 0) o.page = idx + 1;
  } catch { /* page unknown */ }
  return o;
}

/** Lists the form fields (AcroForm). */
export async function formFields(bytes) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const fields = form.getFields().map((f) => describe(doc, f));
  return { count: fields.length, fields, has_xfa: !!doc.catalog.lookup(PDFName.of('AcroForm'))?.get?.(PDFName.of('XFA')) };
}

/** Fills fields. values: { fieldName: string | boolean | string[] }. flatten: make the result non-editable. */
export async function fillForm(bytes, values, { flatten = false } = {}) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const known = new Map(form.getFields().map((f) => [f.getName(), f]));
  const filled = [], problems = [];
  for (const [name, val] of Object.entries(values || {})) {
    const f = known.get(name);
    if (!f) { problems.push({ field: name, problem: 'No such field' }); continue; }
    const t = typeOf(f);
    try {
      if (f.isReadOnly()) throw new Error('Field is read-only');
      if (t === 'text') f.setText(val === null || val === undefined ? undefined : String(val));
      else if (t === 'checkbox') { if (val === true || val === 'true' || val === 'on' || val === 1) f.check(); else f.uncheck(); }
      else if (t === 'dropdown' || t === 'list') {
        const sel = Array.isArray(val) ? val.map(String) : [String(val)];
        const bad = sel.filter((s) => !f.getOptions().includes(s));
        if (bad.length) throw new Error(`Not an option. Possible: ${f.getOptions().join(' | ')}`);
        if (t === 'dropdown') f.select(sel[0]); else f.select(sel);
      } else if (t === 'radio') {
        if (!f.getOptions().includes(String(val))) throw new Error(`Not an option. Possible: ${f.getOptions().join(' | ')}`);
        f.select(String(val));
      } else throw new Error(`Fields of type ${t} cannot be filled`);
      filled.push(name);
    } catch (e) { problems.push({ field: name, problem: String(e.message || e) }); }
  }
  if (filled.length) {
    try { form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch { /* appearance stays as created */ }
    if (flatten) { form.flatten(); doc.catalog.delete(PDFName.of('AcroForm')); fillGaps(doc); }
  }
  return { bytes: filled.length ? await doc.save({ useObjectStreams: false }) : null, filled, problems, flattened: !!(filled.length && flatten) };
}

/** Removes the form fields and keeps their look (for sharing a filled form). */
export async function flattenForm(bytes) {
  const doc = await load(bytes);
  const form = doc.getForm(), n = form.getFields().length;
  if (!n) return { bytes: null, count: 0 };
  form.flatten(); doc.catalog.delete(PDFName.of('AcroForm')); fillGaps(doc);
  return { bytes: await doc.save({ useObjectStreams: false }), count: n };
}

const COLORS = { gray: [0.55, 0.55, 0.55], red: [0.8, 0.1, 0.1], blue: [0.1, 0.25, 0.75], black: [0, 0, 0], green: [0.1, 0.5, 0.2] };

/** Text watermark/stamp. opts: { text, pages (spec or null), opacity, size, angle, color, position: 'center'|'top'|'bottom' } */
export async function watermark(bytes, { text, pages = null, opacity = 0.25, size, angle = 45, color = 'gray', position = 'center' } = {}) {
  size = size || (position === 'center' ? 64 : 28);
  if (!text || !String(text).trim()) throw new Error('"text" is required.');
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = String(text).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  const idx = pages ? parsePages(pages, doc.getPageCount()) : doc.getPages().map((_, i) => i);
  const c = COLORS[color] || (/^#?[0-9a-f]{6}$/i.test(color || '') ? [1, 3, 5].map((i) => parseInt(color.replace('#', '').slice(i - 1, i + 1), 16) / 255) : COLORS.gray);
  const ang = position === 'center' ? angle : 0;
  for (const i of idx) {
    const p = doc.getPage(i), b = p.getCropBox() || p.getMediaBox(), r = ((p.getRotation().angle % 360) + 360) % 360;
    let s = size; const wFull = (r % 180 ? b.height : b.width);
    while (s > 8 && font.widthOfTextAtSize(clean, s) > wFull * (position === 'center' ? 0.85 : 0.9) * (position === 'center' ? Math.max(Math.cos(angle * Math.PI / 180), 0.6) : 1)) s -= 2;
    const w = font.widthOfTextAtSize(clean, s), h = s * 0.35;
    const th = ((ang + r) * Math.PI) / 180;
    let cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (position === 'top' || position === 'bottom') { const dh = r % 180 ? b.width : b.height; const dv = position === 'top' ? dh - s * 1.5 : s * 1.5; const k = dv - dh / 2; if (r === 0) cy += k; else if (r === 90) cx -= k; else if (r === 180) cy -= k; else cx += k; }
    p.drawText(clean, { x: cx - (w / 2) * Math.cos(th) + h * Math.sin(th), y: cy - (w / 2) * Math.sin(th) - h * Math.cos(th), size: s, font, color: rgb(...c), opacity: Math.min(1, Math.max(0.02, opacity)), rotate: degrees(ang + r) });
  }
  return { bytes: await doc.save({ useObjectStreams: false }), pages: idx.map((i) => i + 1) };
}

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
const txt = (o) => (o && typeof o.decodeText === 'function' ? o.decodeText() : o && typeof o.asString === 'function' ? o.asString() : undefined);

/** Reads document metadata. */
export async function readMetadata(bytes) {
  const doc = await load(bytes);
  const infoRef = doc.context.trailerInfo.Info, d = infoRef ? doc.context.lookup(infoRef) : null;
  const out = { fields: {}, custom: {}, has_xmp: !!doc.catalog.get(PDFName.of('Metadata')), encrypted: doc.isEncrypted };
  if (d instanceof PDFDict) for (const [k, v] of d.entries()) {
    const key = k.decodeText(), val = txt(doc.context.lookup(v));
    if (val === undefined) continue;
    (INFO_KEYS.includes(key) ? out.fields : out.custom)[key] = val;
  }
  return out;
}

/** Sets fields and/or removes all metadata (info dictionary and XMP). */
export async function writeMetadata(bytes, { set = {}, clear = false } = {}) {
  const doc = await load(bytes);
  const ctx = doc.context;
  if (clear) {
    ctx.trailerInfo.Info = ctx.register(ctx.obj({}));
    doc.catalog.delete(PDFName.of('Metadata'));
  }
  const map = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', creator: 'Creator', producer: 'Producer' };
  let infoRef = ctx.trailerInfo.Info, d = infoRef ? ctx.lookup(infoRef) : null;
  if (!(d instanceof PDFDict)) { d = ctx.obj({}); ctx.trailerInfo.Info = ctx.register(d); }
  for (const [k, v] of Object.entries(set || {})) {
    const key = map[String(k).toLowerCase()];
    if (!key) throw new Error(`Unknown field "${k}". Possible: ${Object.keys(map).join(', ')}`);
    if (v === null || v === '') d.delete(PDFName.of(key)); else d.set(PDFName.of(key), PDFHexString.fromText(String(v)));
  }
  if (!clear && Object.keys(set || {}).length) doc.catalog.delete(PDFName.of('Metadata')); // XMP would contradict the new values
  return { bytes: await doc.save({ useObjectStreams: false }) };
}
