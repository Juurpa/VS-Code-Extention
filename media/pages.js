// Page tools: selection, context menu, reordering, merging, splitting, compressing, cropping, page numbers
import * as ops from './pdfops.js';
import { S, $, $$, el, modal, toast } from './util.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
export const b64ToBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
export function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const baseName = () => S.name.replace(/\.pdf$/i, '');
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const MM = 72 / 25.4;

S.sel = new Set(); S.dirty = false; S.anchor = 1;

// ------------------------------------------------------------ Change document (with undo)
export async function commit(bytes, ann) {
  S.undo = S.undo.filter((o) => o.op === 'doc');
  S.undo.push({ op: 'doc', bytes: S.bytes, ann: clone(S.ann) }); S.redo = [];
  S.bytes = bytes; S.ann = ann; S.dirty = true; S.texts = []; S.sel = new Set();
  await S.api.reload();
  S.api.updateUndo(); updateDirty();
}
export function updateDirty() {
  const b = $('#tFile'); if (!b) return;
  b.hidden = !S.dirty; b.classList.toggle('primary', S.dirty);
}

const nPages = () => S.pages.length;
const selIdx = () => (S.sel.size ? [...S.sel] : [S.cur]).sort((a, b) => a - b).map((n) => n - 1);
const range = (n) => Array.from({ length: n }, (_, i) => i);

// ------------------------------------------------------------ Selection, menu, dragging
function markSel() { S.pages.forEach((p) => p.thumb?.classList.toggle('sel', S.sel.has(p.n))); updateSelBar(); }
function updateSelBar() {
  const bar = $('#selBar'); if (!bar) return;
  bar.hidden = !S.sel.size; $('#selCount').textContent = S.sel.size + ' ' + (S.sel.size === 1 ? 'page' : 'pages') + ' selected';
}
function thumbClick(e, n) {
  if (e.shiftKey) { const a = Math.min(S.anchor, n), b = Math.max(S.anchor, n); S.sel = new Set(); for (let i = a; i <= b; i++) S.sel.add(i); }
  else if (e.ctrlKey || e.metaKey) { S.sel.has(n) ? S.sel.delete(n) : S.sel.add(n); S.anchor = n; }
  else { S.sel = new Set([n]); S.anchor = n; S.api.goTo(n); }
  markSel();
}
function thumbMenu(e, n) {
  e.preventDefault();
  if (!S.sel.has(n)) { S.sel = new Set([n]); S.anchor = n; markSel(); }
  S.api.showMenu(e.clientX, e.clientY, pageMenuItems());
}
export function pageMenuItems() {
  return [
    { l: 'Rotate left', k: '90°', f: () => rotateSel(-90) },
    { l: 'Rotate right', k: '90°', f: () => rotateSel(90) },
    { l: 'Duplicate', f: duplicateSel },
    { l: 'Delete', k: 'Del', f: deleteSel },
    '-',
    { l: 'Move up', f: () => moveSel(-1) },
    { l: 'Move down', f: () => moveSel(1) },
    '-',
    { l: 'Extract as new PDF', f: extractSel },
    { l: 'Insert pages from PDF after …', f: () => insertFrom(Math.max(...selIdx()) + 1) }
  ];
}

let dragging = null;
function decorateThumb(t, n) {
  t.draggable = true;
  t.addEventListener('dragstart', (e) => {
    if (!S.sel.has(n)) { S.sel = new Set([n]); markSel(); }
    dragging = [...S.sel].sort((a, b) => a - b); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages');
  });
  t.addEventListener('dragover', (e) => {
    if (!dragging) return; e.preventDefault();
    const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    $$('.thumb.dropBefore,.thumb.dropAfter').forEach((x) => x.classList.remove('dropBefore', 'dropAfter'));
    t.classList.add(after ? 'dropAfter' : 'dropBefore');
  });
  t.addEventListener('dragleave', () => t.classList.remove('dropBefore', 'dropAfter'));
  t.addEventListener('drop', (e) => {
    e.preventDefault(); const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    $$('.thumb.dropBefore,.thumb.dropAfter').forEach((x) => x.classList.remove('dropBefore', 'dropAfter'));
    const sel = dragging; dragging = null; if (sel) dropMove(sel, n - 1 + (after ? 1 : 0));
  });
  t.addEventListener('dragend', () => { dragging = null; $$('.thumb.dropBefore,.thumb.dropAfter').forEach((x) => x.classList.remove('dropBefore', 'dropAfter')); });
  t.addEventListener('click', (e) => thumbClick(e, n));
  t.addEventListener('contextmenu', (e) => thumbMenu(e, n));
}

// ------------------------------------------------------------ Page actions
async function guard(fn) {
  try { await fn(); } catch (e) { console.error(e); toast('Error: ' + (e.message || e), 6000); }
}
export const rotateSel = (d) => guard(async () => {
  const idx = selIdx(); const keep = [...S.sel];
  await commit(await ops.rotate(S.bytes, idx, d), ops.annRotate(clone(S.ann), idx, d)); void keep;
});
export const deleteSel = () => guard(async () => {
  const idx = selIdx(), n = nPages();
  if (idx.length >= n) { toast('At least one page must remain.'); return; }
  const rest = range(n).filter((i) => !idx.includes(i));
  await commit(await ops.remove(S.bytes, idx), ops.annReorder(S.ann, rest));
  toast(idx.length + (idx.length === 1 ? ' page deleted' : ' pages deleted') + ' – undo with Ctrl+Z.');
});
export const duplicateSel = () => guard(async () => {
  const idx = selIdx(), order = [];
  range(nPages()).forEach((i) => { order.push(i); if (idx.includes(i)) order.push(i); });
  await commit(await ops.reorder(S.bytes, order), ops.annReorder(S.ann, order));
});
async function dropMove(selNums, target) { // target = insert position (0..n) in the old order
  const sel = selNums.map((n) => n - 1), n = nPages();
  const rest = range(n).filter((i) => !sel.includes(i)), pos = rest.filter((i) => i < target).length;
  const order = [...rest.slice(0, pos), ...sel, ...rest.slice(pos)];
  if (order.every((v, i) => v === i)) return;
  await guard(async () => { await commit(await ops.reorder(S.bytes, order), ops.annReorder(S.ann, order)); });
}
const moveSel = (dir) => {
  const idx = selIdx(); const t = dir < 0 ? Math.max(0, idx[0] - 1) : Math.min(nPages(), idx[idx.length - 1] + 2);
  dropMove(idx.map((i) => i + 1), t);
};
export const extractSel = () => guard(async () => {
  const idx = selIdx(), bytes = await ops.extract(S.bytes, idx);
  const label = idx.length === 1 ? 'S' + (idx[0] + 1) : 'S' + (idx[0] + 1) + '-' + (idx[idx.length - 1] + 1);
  const r = await S.api.request({ type: 'saveMany', files: [{ name: `${baseName()}_${label}.pdf`, b64: toB64(bytes) }] });
  if (r.ok) toast('Saved: ' + r.names.join(', '), 5000);
});
export const insertFrom = (at) => guard(async () => {
  const r = await S.api.request({ type: 'pickPdfs', multi: false });
  if (!r.files?.length) return;
  const other = b64ToBytes(r.files[0].b64), k = await ops.pageCount(other), n = nPages();
  const order = [...range(at), ...Array(k).fill(-1), ...range(n).slice(at)];
  await commit(await ops.insert(S.bytes, other, at), ops.annReorder(S.ann, order));
  toast(k + (k === 1 ? ' page' : ' pages') + ' inserted from "' + r.files[0].name + '".');
});

// ------------------------------------------------------------ Dialogs
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
const numInput = (v, min, max, step = 1) => el('input', { type: 'number', value: v, min, max, step });

export function mergeDialog() {
  const items = [{ name: S.name + '  (this document)', bytes: null, self: true }];
  const list = el('div', { class: 'mlist' });
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => el('div', { class: 'mrow' },
      el('span', { class: 'mname' }, (i + 1) + '. ' + it.name),
      el('button', { class: 'tb icon', title: 'Move up', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, '↑'),
      el('button', { class: 'tb icon', title: 'Move down', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, '↓'),
      el('button', { class: 'tb icon', title: 'Remove', disabled: items.length < 2, onclick: () => { items.splice(i, 1); draw(); } }, '✕'))));
  };
  draw();
  const add = el('button', { class: 'pillBtn', onclick: async () => {
    const r = await S.api.request({ type: 'pickPdfs', multi: true });
    (r.files || []).forEach((f) => items.push({ name: f.name, bytes: b64ToBytes(f.b64) })); draw();
  } }, '+ Add PDF files …');
  modal({ title: 'Merge PDFs', wide: true, body: el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Set the order. The result replaces this document in the editor; the file is only written when you click "Save".'), list, add),
    actions: [{ label: 'Cancel' }, { label: 'Merge', primary: true, onClick: () => {
      if (items.length < 2) { toast('Please add at least one more PDF.'); return false; }
      guard(async () => { const merged = await ops.merge(items.map((it) => it.bytes || S.bytes)); const order = []; let off = 0;
        for (const it of items) { const k = it.self ? nPages() : await ops.pageCount(it.bytes); if (it.self) order.push(...range(k)); else order.push(...Array(k).fill(-1)); off += k; } void off;
        await commit(merged, ops.annReorder(S.ann, order)); toast('Merged: ' + nPages() + ' pages.'); });
    } }] });
}

export function splitDialog() {
  const n = nPages();
  const mode = el('select', {}, el('option', { value: 'ranges' }, 'By page ranges'), el('option', { value: 'every' }, 'Every … pages'));
  const ranges = el('input', { type: 'text', value: n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1', placeholder: '1-3, 4-6, 7' });
  const every = numInput(1, 1, n); const rowR = field('Ranges', ranges, 'Each range becomes its own PDF. Example: 1-3, 5, 7-9'), rowE = field('Pages per file', every); rowE.hidden = true;
  mode.onchange = () => { rowR.hidden = mode.value !== 'ranges'; rowE.hidden = mode.value !== 'every'; };
  modal({ title: 'Split PDF', body: el('div', { class: 'stack' }, field('Mode', mode), rowR, rowE, el('p', { class: 'muted' }, 'The files are saved next to the original PDF.')),
    actions: [{ label: 'Cancel' }, { label: 'Split', primary: true, onClick: () => {
      guard(async () => {
        const parts = await ops.split(S.bytes, mode.value === 'every' ? { every: Math.max(1, +every.value | 0) } : { ranges: ranges.value });
        const r = await S.api.request({ type: 'saveMany', files: parts.map((p) => ({ name: `${baseName()}_${p.label}.pdf`, b64: toB64(p.bytes) })) });
        if (r.ok) toast(r.names.length + ' files saved.', 5000);
      });
    } }] });
}

export function cropDialog() {
  const t = numInput(0, 0, 200), r = numInput(0, 0, 200), b = numInput(0, 0, 200), l = numInput(0, 0, 200);
  const scope = el('select', {}, el('option', { value: 'all' }, 'All pages'), el('option', { value: 'sel' }, 'Selected pages (' + selIdx().length + ')'));
  modal({ title: 'Crop pages', body: el('div', { class: 'stack' }, el('div', { class: 'grid4' }, field('Top (mm)', t), field('Right (mm)', r), field('Bottom (mm)', b), field('Left (mm)', l)), field('Apply to', scope), el('p', { class: 'muted' }, 'Trims the visible area; the content remains in the file.')),
    actions: [{ label: 'Cancel' }, { label: 'Crop', primary: true, onClick: () => {
      guard(async () => { const m = { top: +t.value * MM, right: +r.value * MM, bottom: +b.value * MM, left: +l.value * MM };
        await commit(await ops.crop(S.bytes, m, scope.value === 'sel' ? selIdx() : undefined), clone(S.ann)); });
    } }] });
}

export function numberDialog() {
  const fmt = el('input', { type: 'text', value: 'Page {n} of {N}' });
  const pos = el('select', {}, ...[['bottom-center', 'Bottom center'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top center'], ['top-right', 'Top right'], ['top-left', 'Top left']].map(([v, t]) => el('option', { value: v }, t)));
  const size = numInput(10, 6, 30), start = numInput(1, 0, 9999);
  modal({ title: 'Insert page numbers', body: el('div', { class: 'stack' }, field('Format', fmt, '{n} = page number, {N} = total pages'), field('Position', pos), el('div', { class: 'grid2' }, field('Font size', size), field('First number', start))),
    actions: [{ label: 'Cancel' }, { label: 'Insert', primary: true, onClick: () => {
      guard(async () => commit(await ops.numberPages(S.bytes, { format: fmt.value, pos: pos.value, size: +size.value, start: +start.value }), clone(S.ann)));
    } }] });
}

async function renderJpeg(rec, scale, q) {
  const vp = rec.page.getViewport({ scale }), c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await rec.page.render({ canvasContext: g, viewport: vp }).promise;
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: vp.width / scale, height: vp.height / scale };
}
export { renderJpeg };

export function compressDialog() {
  const mode = el('select', {}, el('option', { value: 'light' }, 'Light – text stays, small savings'), el('option', { value: 'strong' }, 'Strong – pages become images (text no longer selectable)'));
  const q = el('select', {}, el('option', { value: '110|0.6' }, 'Small (110 dpi)'), el('option', { value: '150|0.72' }, 'Medium (150 dpi)'), el('option', { value: '200|0.8' }, 'Good (200 dpi)')); q.value = '150|0.72';
  const qRow = field('Image quality', q); qRow.hidden = true; mode.onchange = () => { qRow.hidden = mode.value !== 'strong'; };
  const info = el('p', { class: 'muted' }, 'Current size: ' + kb(S.bytes.length));
  const run = async (api) => {
    const before = S.bytes.length; let out;
    if (mode.value === 'light') out = await ops.optimize(S.bytes);
    else {
      const [dpi, jq] = q.value.split('|'); const scale = +dpi / 72, items = [];
      for (const rec of S.pages) { info.textContent = `Page ${rec.n} of ${nPages()} …`; items.push({ index: rec.n - 1, ...(await renderJpeg(rec, scale, +jq)) }); }
      out = await ops.replaceWithImages(S.bytes, items);
    }
    if (out.length >= before) { toast('The result would not be smaller (' + kb(out.length) + '). Nothing was changed.', 5000); return; }
    await commit(out, clone(S.ann)); toast(`Compressed: ${kb(before)} → ${kb(out.length)}`, 5000);
  };
  modal({ title: 'Compress PDF', body: el('div', { class: 'stack' }, field('Mode', mode), qRow, info),
    actions: [{ label: 'Cancel' }, { label: 'Compress', primary: true, onClick: (api) => { guard(() => run(api)); } }] });
}

// ------------------------------------------------------------ Saving
export async function saveFile() {
  await guard(async () => {
    const r = await S.api.request({ type: 'confirmOverwrite', name: S.name }); if (!r.ok) return;
    const w = await S.api.request({ type: 'saveFile', b64: toB64(S.bytes) });
    if (w.ok) { S.dirty = false; updateDirty(); toast('Saved.'); S.api.flushAnn(); const t = await S.api.getAllTexts(); S.api.post({ type: 'saveText', texts: t }); }
  });
}
export async function saveAs() {
  await guard(async () => {
    const w = await S.api.request({ type: 'saveAs', b64: toB64(S.bytes), suggested: baseName() + '_new.pdf' });
    if (w.ok) toast('Saved: ' + w.name, 5000);
  });
}

export function initPages() {
  S.api.decorateThumb = decorateThumb; S.api.markSel = markSel; S.api.updateDirty = updateDirty;
  $('#selBar').append(
    el('span', { id: 'selCount', class: 'muted' }),
    el('button', { class: 'tb icon', title: 'Rotate left', onclick: () => rotateSel(-90) }, '↺'),
    el('button', { class: 'tb icon', title: 'Rotate right', onclick: () => rotateSel(90) }, '↻'),
    el('button', { class: 'tb icon', title: 'Delete (Del)', onclick: deleteSel, html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' }),
    el('button', { class: 'tb icon', title: 'Extract as new PDF', onclick: extractSel, html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>' }));
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing) return;
    if (e.key === 'Delete' && S.sel.size && $('#side').contains(document.activeElement || e.target)) { e.preventDefault(); deleteSel(); }
    if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && $('#side').contains(document.activeElement)) { e.preventDefault(); S.sel = new Set(S.pages.map((p) => p.n)); markSel(); }
  });
}
