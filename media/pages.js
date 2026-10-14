// Page tools: selection, context menu, reordering, merging, splitting, compressing, cropping, page numbers
import * as ops from './pdfops.js';
import { S, $, $$, el, modal, toast, icon } from './util.js';
import { t } from './i18n.js';

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
  bar.hidden = !S.sel.size; $('#selCount').textContent = S.sel.size === 1 ? t('{n} page selected', { n: S.sel.size }) : t('{n} pages selected', { n: S.sel.size });
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
    { l: t('Rotate left'), k: '90°', f: () => rotateSel(-90) },
    { l: t('Rotate right'), k: '90°', f: () => rotateSel(90) },
    { l: t('Duplicate'), f: duplicateSel },
    { l: t('Delete'), k: 'Del', f: deleteSel },
    '-',
    { l: t('Move up'), f: () => moveSel(-1) },
    { l: t('Move down'), f: () => moveSel(1) },
    '-',
    { l: t('Extract as new PDF'), f: extractSel },
    { l: t('Insert pages from PDF after …'), f: () => insertFrom(Math.max(...selIdx()) + 1) }
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
  if (idx.length >= n) { toast(t('At least one page must remain.')); return; }
  const rest = range(n).filter((i) => !idx.includes(i));
  await commit(await ops.remove(S.bytes, idx), ops.annReorder(S.ann, rest));
  toast(idx.length === 1 ? t('{n} page deleted – undo with Ctrl+Z.', { n: idx.length }) : t('{n} pages deleted – undo with Ctrl+Z.', { n: idx.length }));
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
  if (r.ok) toast(t('Saved: {names}', { names: r.names.join(', ') }), 5000);
});
export const insertFrom = (at) => guard(async () => {
  const r = await S.api.request({ type: 'pickPdfs', multi: false });
  if (!r.files?.length) return;
  const other = b64ToBytes(r.files[0].b64), k = await ops.pageCount(other), n = nPages();
  const order = [...range(at), ...Array(k).fill(-1), ...range(n).slice(at)];
  await commit(await ops.insert(S.bytes, other, at), ops.annReorder(S.ann, order));
  toast(k === 1 ? t('{n} page inserted from "{name}".', { n: k, name: r.files[0].name }) : t('{n} pages inserted from "{name}".', { n: k, name: r.files[0].name }));
});

// ------------------------------------------------------------ Dialogs
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
const numInput = (v, min, max, step = 1) => el('input', { type: 'number', value: v, min, max, step });

export function mergeDialog() {
  const items = [{ name: S.name + '  ' + t('(this document)'), bytes: null, self: true }];
  const list = el('div', { class: 'mlist' });
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => el('div', { class: 'mrow' },
      el('span', { class: 'mname' }, (i + 1) + '. ' + it.name),
      el('button', { class: 'tb icon', title: t('Move up'), disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, '↑'),
      el('button', { class: 'tb icon', title: t('Move down'), disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, '↓'),
      el('button', { class: 'tb icon', title: t('Remove'), disabled: items.length < 2, onclick: () => { items.splice(i, 1); draw(); } }, '✕'))));
  };
  draw();
  const add = el('button', { class: 'pillBtn', onclick: async () => {
    const r = await S.api.request({ type: 'pickPdfs', multi: true });
    (r.files || []).forEach((f) => items.push({ name: f.name, bytes: b64ToBytes(f.b64) })); draw();
  } }, t('+ Add PDF files …'));
  modal({ title: t('Merge PDFs'), wide: true, body: el('div', { class: 'stack' }, el('p', { class: 'muted' }, t('Set the order. The result replaces this document in the editor; the file is only written when you click "Save".')), list, add),
    actions: [{ label: t('Cancel') }, { label: t('Merge'), primary: true, onClick: () => {
      if (items.length < 2) { toast(t('Please add at least one more PDF.')); return false; }
      guard(async () => { const merged = await ops.merge(items.map((it) => it.bytes || S.bytes)); const order = []; let off = 0;
        for (const it of items) { const k = it.self ? nPages() : await ops.pageCount(it.bytes); if (it.self) order.push(...range(k)); else order.push(...Array(k).fill(-1)); off += k; } void off;
        await commit(merged, ops.annReorder(S.ann, order)); toast(t('Merged: {n} pages.', { n: nPages() })); });
    } }] });
}

export function splitDialog() {
  const n = nPages();
  const mode = el('select', {}, el('option', { value: 'ranges' }, t('By page ranges')), el('option', { value: 'every' }, t('Every … pages')));
  const ranges = el('input', { type: 'text', value: n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1', placeholder: '1-3, 4-6, 7' });
  const every = numInput(1, 1, n); const rowR = field(t('Ranges'), ranges, t('Each range becomes its own PDF. Example: 1-3, 5, 7-9')), rowE = field(t('Pages per file'), every); rowE.hidden = true;
  mode.onchange = () => { rowR.hidden = mode.value !== 'ranges'; rowE.hidden = mode.value !== 'every'; };
  modal({ title: t('Split PDF'), body: el('div', { class: 'stack' }, field(t('Mode'), mode), rowR, rowE, el('p', { class: 'muted' }, t('The files are saved next to the original PDF.'))),
    actions: [{ label: t('Cancel') }, { label: t('Split'), primary: true, onClick: () => {
      guard(async () => {
        const parts = await ops.split(S.bytes, mode.value === 'every' ? { every: Math.max(1, +every.value | 0) } : { ranges: ranges.value });
        const r = await S.api.request({ type: 'saveMany', files: parts.map((p) => ({ name: `${baseName()}_${p.label}.pdf`, b64: toB64(p.bytes) })) });
        if (r.ok) toast(t('{n} files saved.', { n: r.names.length }), 5000);
      });
    } }] });
}

export function cropDialog() {
  const tp = numInput(0, 0, 200), r = numInput(0, 0, 200), b = numInput(0, 0, 200), l = numInput(0, 0, 200);
  const scope = el('select', {}, el('option', { value: 'all' }, t('All pages')), el('option', { value: 'sel' }, t('Selected pages ({n})', { n: selIdx().length })));
  modal({ title: t('Crop pages'), body: el('div', { class: 'stack' }, el('div', { class: 'grid4' }, field(t('Top (mm)'), tp), field(t('Right (mm)'), r), field(t('Bottom (mm)'), b), field(t('Left (mm)'), l)), field(t('Apply to'), scope), el('p', { class: 'muted' }, t('Trims the visible area; the content remains in the file.'))),
    actions: [{ label: t('Cancel') }, { label: t('Crop'), primary: true, onClick: () => {
      guard(async () => { const m = { top: +tp.value * MM, right: +r.value * MM, bottom: +b.value * MM, left: +l.value * MM };
        await commit(await ops.crop(S.bytes, m, scope.value === 'sel' ? selIdx() : undefined), clone(S.ann)); });
    } }] });
}

// Page numbers: styles with examples, position grid and a live preview on the real page
// The word in the page number follows the interface language (evaluated when the dialog opens)
export const numberStyles = () => [['{n}', '1'], ['- {n} -', '- 1 -'], [t('Page {n}'), t('Page 1')], [t('Page {n} of {N}'), t('Page 1 of 9')], ['{n} / {N}', '1 / 9']];
export function numberDialog() {
  const st = { format: t('Page {n} of {N}'), pos: 'bottom-center', size: 11, margin: 24, start: 1, skipFirst: false, onlySel: false };
  const N = nPages(), cur = S.cur, sel = S.sel.size > 1 ? [...S.sel].sort((a, b) => a - b).map((n) => n - 1) : null;
  const fmtText = (i) => st.format.replace(/\{n\}/g, String(st.start + i)).replace(/\{N\}/g, String(N + st.start - 1));
  const prev = el('div', { class: 'numPrev' }), cv = el('canvas'), tag = el('div', { class: 'numTag' });
  prev.append(cv, tag);
  let vp = null;
  const refresh = () => {
    if (!vp) return;
    const k = prev.clientWidth / vp.width, [vert, hor] = st.pos.split('-'), m = st.margin * k;
    const i = cur - 1, hidden = (st.skipFirst && i === 0) || (st.onlySel && sel && !sel.includes(i));
    tag.textContent = hidden ? '' : fmtText(i);
    tag.style.cssText = `font-size:${st.size * k}px;` + (vert === 'top' ? `top:${m}px;` : `bottom:${m}px;`) +
      (hor === 'left' ? `left:${m}px;` : hor === 'right' ? `right:${m}px;` : 'left:50%;transform:translateX(-50%);');
  };
  S.pdf.getPage(cur).then(async (pg) => {
    vp = pg.getViewport({ scale: 1 }); const k = 260 / vp.width, v = pg.getViewport({ scale: k * 2 });
    cv.width = v.width; cv.height = v.height; prev.style.width = '260px'; prev.style.aspectRatio = vp.width + ' / ' + vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: v }).promise; refresh();
  });
  const radios = new Map(), cards = el('div', { class: 'numStyles' });
  const custom = el('input', { type: 'text', value: st.format, 'aria-label': t('Custom format') });
  const pickStyle = (f) => { st.format = f; custom.value = f; radios.forEach((b, k) => b.classList.toggle('on', k === f)); refresh(); };
  numberStyles().forEach(([f, ex]) => { const b = el('button', { type: 'button', class: 'numCard', 'data-fmt': f, onclick: () => pickStyle(f) }, el('b', {}, ex)); radios.set(f, b); cards.append(b); });
  custom.addEventListener('input', () => { st.format = custom.value; radios.forEach((b, k) => b.classList.toggle('on', k === st.format)); refresh(); });
  const grid = el('div', { class: 'numGrid', role: 'radiogroup', 'aria-label': t('Position') }), cells = new Map();
  [['top-left', t('Top left')], ['top-center', t('Top center')], ['top-right', t('Top right')], ['bottom-left', t('Bottom left')], ['bottom-center', t('Bottom center')], ['bottom-right', t('Bottom right')]].forEach(([v, t]) => {
    const c = el('button', { type: 'button', class: 'numCell', title: t, 'aria-label': t, 'data-pos': v, onclick: () => { st.pos = v; cells.forEach((x, k) => x.classList.toggle('on', k === v)); refresh(); } });
    cells.set(v, c); grid.append(c);
  });
  const slider = (min, max, key, unit) => {
    const out = el('output', {}, st[key] + ' ' + unit), r = el('input', { type: 'range', min, max, value: st[key], 'aria-label': t(key === 'size' ? 'Font size' : 'Distance from edge') });
    r.addEventListener('input', () => { st[key] = +r.value; out.textContent = r.value + ' ' + unit; refresh(); });
    return el('div', { class: 'sl' }, r, out);
  };
  const start = numInput(1, 0, 9999); start.addEventListener('input', () => { st.start = Math.max(0, Math.floor(+start.value) || 0); refresh(); });
  const skip = el('input', { type: 'checkbox' }); skip.addEventListener('change', () => { st.skipFirst = skip.checked; refresh(); });
  const only = el('input', { type: 'checkbox' }); only.addEventListener('change', () => { st.onlySel = only.checked; refresh(); });
  pickStyle(st.format); cells.get(st.pos).classList.add('on');
  const body = el('div', { class: 'numDlg' },
    el('div', { class: 'stack' },
      field(t('Style'), cards), field(t('Custom format'), custom, t('{n} = page number, {N} = total pages')),
      field(t('Position'), grid), field(t('Font size'), slider(6, 30, 'size', 'pt')), field(t('Distance from edge'), slider(10, 72, 'margin', 'pt')),
      el('div', { class: 'grid2' }, field(t('First number'), start)),
      el('label', { class: 'chk' }, skip, t('Skip the first page (for example a cover)')),
      sel ? el('label', { class: 'chk' }, only, t('Only the {n} selected pages', { n: sel.length })) : null),
    el('div', { class: 'numSide' }, el('span', { class: 'muted' }, t('Preview, page {n}', { n: cur })), prev));
  modal({ title: t('Insert page numbers'), wide: true, body, actions: [{ label: t('Cancel') }, { label: t('Insert'), primary: true, onClick: () => {
    guard(async () => commit(await ops.numberPages(S.bytes, { format: st.format, pos: st.pos, size: st.size, margin: st.margin, start: st.start, skipFirst: st.skipFirst, only: st.onlySel && sel ? sel : null }), clone(S.ann)));
  } }] });
  requestAnimationFrame(refresh);
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
  const mode = el('select', {}, el('option', { value: 'light' }, t('Light – text stays, small savings')), el('option', { value: 'strong' }, t('Strong – pages become images (text no longer selectable)')));
  const q = el('select', {}, el('option', { value: '110|0.6' }, t('Small (110 dpi)')), el('option', { value: '150|0.72' }, t('Medium (150 dpi)')), el('option', { value: '200|0.8' }, t('Good (200 dpi)'))); q.value = '150|0.72';
  const qRow = field(t('Image quality'), q); qRow.hidden = true; mode.onchange = () => { qRow.hidden = mode.value !== 'strong'; };
  const info = el('p', { class: 'muted' }, t('Current size: {size}', { size: kb(S.bytes.length) }));
  const run = async (api) => {
    const before = S.bytes.length; let out;
    if (mode.value === 'light') out = await ops.optimize(S.bytes);
    else {
      const [dpi, jq] = q.value.split('|'); const scale = +dpi / 72, items = [];
      for (const rec of S.pages) { info.textContent = t('Page {n} of {N} …', { n: rec.n, N: nPages() }); items.push({ index: rec.n - 1, ...(await renderJpeg(rec, scale, +jq)) }); }
      out = await ops.replaceWithImages(S.bytes, items);
    }
    if (out.length >= before) { toast(t('The result would not be smaller ({size}). Nothing was changed.', { size: kb(out.length) }), 5000); return; }
    await commit(out, clone(S.ann)); toast(t('Compressed: {before} → {after}', { before: kb(before), after: kb(out.length) }), 5000);
  };
  modal({ title: t('Compress PDF'), body: el('div', { class: 'stack' }, field(t('Mode'), mode), qRow, info),
    actions: [{ label: t('Cancel') }, { label: t('Compress'), primary: true, onClick: (api) => { guard(() => run(api)); } }] });
}

// ------------------------------------------------------------ Saving
export async function saveFile() {
  await guard(async () => {
    const r = await S.api.request({ type: 'confirmOverwrite', name: S.name }); if (!r.ok) return;
    const w = await S.api.request({ type: 'saveFile', b64: toB64(S.bytes) });
    if (w.ok) { S.dirty = false; updateDirty(); toast(t('Saved.')); S.api.flushAnn(); const txt = await S.api.getAllTexts(); S.api.post({ type: 'saveText', texts: txt }); }
  });
}
export async function saveAs() {
  await guard(async () => {
    const w = await S.api.request({ type: 'saveAs', b64: toB64(S.bytes), suggested: baseName() + '_new.pdf' });
    if (w.ok) toast(t('Saved: {names}', { names: w.name }), 5000);
  });
}

export function initPages() {
  S.api.decorateThumb = decorateThumb; S.api.markSel = markSel; S.api.updateDirty = updateDirty;
  $('#selBar').append(
    el('span', { id: 'selCount', class: 'muted' }),
    el('button', { class: 'tb icon', title: t('Rotate left'), onclick: () => rotateSel(-90), html: icon('rotateLeft') }),
    el('button', { class: 'tb icon', title: t('Rotate right'), onclick: () => rotateSel(90), html: icon('rotate') }),
    el('button', { class: 'tb icon', title: t('Delete (Del)'), onclick: deleteSel, html: icon('trash') }),
    el('button', { class: 'tb icon', title: t('Extract as new PDF'), onclick: extractSel, html: icon('extract') }));
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing) return;
    if (e.key === 'Delete' && S.sel.size && $('#side').contains(document.activeElement || e.target)) { e.preventDefault(); deleteSel(); }
    if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && $('#side').contains(document.activeElement)) { e.preventDefault(); S.sel = new Set(S.pages.map((p) => p.n)); markSel(); }
  });
}
