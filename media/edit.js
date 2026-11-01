// Editing on the page: rewrite existing text lines ("Edit text"), add new text boxes ("Text"), insert images ("Image").
// Rewriting deletes the old letters for real (same engine as redaction, without a bar; mcp/edittext.mjs).
import { S, $, $$, el, icon, toast, modal, uid } from './util.js';
import { commit, toB64, b64ToBytes } from './pages.js';
import { t } from './i18n.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
S.edits = []; S.txt = { size: 12, color: '#212121', bold: false };
export const TEXT_COLORS = ['#212121', '#e53935', '#1e88e5', '#43a047', '#f57c00', '#8e24aa'];

// ------------------------------------------------------------ Lines from pdf.js (for hovering and choosing what to edit)
const lineCache = new Map();
async function linesOfPage(n) {
  const key = S.docId + ':' + n; if (lineCache.has(key)) return lineCache.get(key);
  const p = S.pages[n - 1], tc = await S.api.textContent(n), vp = p.page.getViewport({ scale: 1 }), lines = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tr = it.transform, h = Math.hypot(tr[2], tr[3]) || it.height || 10;
    if (Math.abs(tr[1]) > 0.01 * Math.abs(tr[0]) + 0.001) continue; // only horizontal text in the page's own direction
    const pts = [[tr[4], tr[5] - 0.25 * h], [tr[4] + it.width, tr[5] + 0.9 * h]].map(([x, y]) => vp.convertToViewportPoint(x, y));
    const r = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
    const cy = (r[1] + r[3]) / 2, hh = r[3] - r[1];
    const ln = lines.find((l) => Math.abs(l.cy - cy) < 0.35 * Math.min(l.h, hh) && r[0] - l.r[2] < 2.5 * hh && l.r[0] - r[2] < 2.5 * hh);
    if (ln) { ln.r = [Math.min(ln.r[0], r[0]), Math.min(ln.r[1], r[1]), Math.max(ln.r[2], r[2]), Math.max(ln.r[3], r[3])]; }
    else lines.push({ r, cy, h: hh });
  }
  const out = lines.map((l) => ({ x: l.r[0] / vp.width, y: l.r[1] / vp.height, w: (l.r[2] - l.r[0]) / vp.width, h: (l.r[3] - l.r[1]) / vp.height }));
  lineCache.set(key, out); return out;
}
const lineAt = (lines, x, y) => lines.find((l) => x >= l.x - 0.005 && x <= l.x + l.w + 0.005 && y >= l.y && y <= l.y + l.h);
const posIn = (pe, e) => { const b = pe.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
// Same families as the engine writes with (Times / Courier / Liberation Sans)
const fontCss = (f) => (f === 'serif' ? '"Times New Roman",Times,serif' : f === 'mono' ? '"Courier New",Courier,monospace' : 'Arial,"Liberation Sans",sans-serif');
const boxStyle = (r) =>`left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;

// The document is sent to the extension only when it changed since the last time
let sentBytes = null;
const withBytes = (msg) => { if (sentBytes !== S.bytes) { sentBytes = S.bytes; return { ...msg, b64: toB64(S.bytes) }; } return msg; };

// ------------------------------------------------------------ Edit text
let hoverEl = null, editor = null;
function onHover(e) {
  if (S.tool !== 'edit' || editor) return;
  const pe = e.target.closest?.('.page'); if (!pe) { hoverEl?.remove(); return; }
  const n = +pe.dataset.page, [x, y] = posIn(pe, e);
  linesOfPage(n).then((lines) => {
    const l = lineAt(lines, x, y); if (!l || S.tool !== 'edit' || editor) { hoverEl?.remove(); return; }
    if (!hoverEl) hoverEl = el('div', { class: 'edHover' });
    hoverEl.style.cssText = boxStyle(l); if (hoverEl.parentElement !== pe) pe.append(hoverEl);
  });
}
async function onEditClick(e) {
  if (S.tool !== 'edit' || e.button !== 0 || e.target.closest('.edBox,.edStaged,.edBar')) return;
  const pe = e.target.closest('.page'); if (!pe) return;
  const n = +pe.dataset.page, [x, y] = posIn(pe, e), l = lineAt(await linesOfPage(n), x, y);
  if (!l) { toast(t('Click on a line of text. Scanned pages need text recognition (OCR) first.'), 4500); return; }
  closeEditor(false);
  const pad = l.h * 0.4;
  const r = await S.api.request(withBytes({ type: 'readLines', box: { page: n, x: l.x - 0.002, y: l.y - pad * 0.3, w: l.w + 0.004, h: l.h + pad * 0.6 } }));
  if (!r.ok || !r.line) { toast(r.error ? 'Error: ' + r.error : t('This line cannot be read. Try clicking directly on the letters.'), 5000); return; }
  openEditor(n, r.line);
}
function openEditor(n, line, staged) {
  const p = S.pages[n - 1], st = { ...(line.style || {}), ...(staged?.style || {}) };
  const box = el('div', { class: 'edBox' }); box.style.cssText = boxStyle(line.box);
  const ta = el('textarea', { spellcheck: 'true', 'aria-label': t('New text') }); ta.value = staged ? staged.text : line.text;
  const size = () => (staged?.size || line.size);
  const look = () => { ta.style.fontSize = `calc(var(--scale-factor) * ${size() * 0.96}px)`; ta.style.fontWeight = st.bold ? '700' : '400'; ta.style.fontStyle = st.italic ? 'italic' : 'normal'; ta.style.color = st.color || '#000'; ta.style.fontFamily = fontCss(st.font); ta.rows = Math.max(1, ta.value.split('\n').length); };
  const changed = { style: staged?.style ? { ...staged.style } : {} };
  const tog = (k) => { st[k] = !st[k]; changed.style[k] = st[k]; look(); ta.focus(); };
  const bBold = el('button', { class: 'tb icon', title: t('Bold'), html: icon('bold'), onmousedown: (e) => e.preventDefault(), onclick: () => tog('bold') });
  const bIt = el('button', { class: 'tb icon', title: t('Italic'), html: icon('italic'), onmousedown: (e) => e.preventDefault(), onclick: () => tog('italic') });
  const colors = el('span', { class: 'edColors' }, ...TEXT_COLORS.map((c) => el('button', { class: 'swatch sm', style: `background:${c}`, title: t('Color'), onmousedown: (e) => e.preventDefault(), onclick: () => { st.color = c; changed.style.color = c; look(); ta.focus(); } })));
  const ok = el('button', { class: 'pillBtn primary sm', onmousedown: (e) => e.preventDefault(), onclick: () => stage() }, el('span', { class: 'mic', html: icon('check') }), t('OK'));
  const bar = el('div', { class: 'edBar' }, bBold, bIt, colors, el('span', { class: 'muted' }, t('Enter = OK · Shift+Enter = new line · Esc = cancel')), ok);
  box.append(ta, bar); p.el.append(box); hoverEl?.remove();
  editor = { n, line, box, staged };
  look(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', look);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stage(); } else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); } });
  function stage() {
    const text = ta.value.replace(/\s+$/g, '');
    if (staged) S.edits = S.edits.filter((x) => x !== staged);
    if (text !== line.text || Object.keys(changed.style).length) S.edits.push({ page: n, box: line.box, text, old: line.text, size: line.size, line, style: Object.keys(changed.style).length ? changed.style : undefined, look: { ...st } });
    closeEditor(true);
  }
}
function closeEditor(render) { if (editor) { editor.box.remove(); editor = null; } if (render !== false) drawStaged(); S.api.renderToolOpts(); }
export function drawStaged() {
  $$('.edStaged').forEach((x) => x.remove());
  for (const s of S.edits) {
    const p = S.pages[s.page - 1]; if (!p) continue;
    const d = el('div', { class: 'edStaged', title: t('Changed – click to edit again'), onclick: (e) => { e.stopPropagation(); if (S.tool === 'edit') { d.remove(); openEditor(s.page, s.line, s); } } });
    // At least as wide as the old line, so no old letters show next to a shorter new text
    d.style.cssText = boxStyle(s.box) + `;--w:${s.box.w * 100}%;font-size:calc(var(--scale-factor) * ${s.size * 0.96}px);font-family:${fontCss(s.look.font)};font-weight:${s.look.bold ? 700 : 400};font-style:${s.look.italic ? 'italic' : 'normal'};color:${s.look.color || '#000'}`;
    d.textContent = s.text; p.el.append(d);
  }
}
async function applyEdits() {
  if (!S.edits.length) return;
  const m = modal({ title: t('Edit text'), body: el('p', {}, t('Rewriting {n} line(s) and checking the result …', { n: S.edits.length })), actions: [] });
  try {
    const r = await S.api.request(withBytes({ type: 'editText', edits: S.edits.map((s) => ({ page: s.page, ...s.box, text: s.text, style: s.style })) }));
    if (!r.ok) throw new Error(r.error || t('Editing failed.'));
    const n = S.edits.length; S.edits = [];
    if (r.b64) await commit(b64ToBytes(r.b64), clone(S.ann));
    drawStaged(); S.api.renderToolOpts();
    toast(t('{n} line(s) rewritten. The old text was removed from the file. Save with File → Save or Save as.', { n }) + (r.covered?.length ? ' ' + t('On page {pages} the old line was still visible underneath (scan or outlined text), so it is covered there in the background colour.', { pages: r.covered.join(', ') }) : ''), 8000);
  } catch (e) { toast('Error: ' + (e.message || e), 9000); }
  finally { m.close(); }
}
export function discardEdits() { S.edits = []; closeEditor(true); }
/** Called before switching away from the edit tool: unapplied changes are applied or dropped on request. */
export function leaveEdit(next) {
  if (!S.edits.length) { closeEditor(false); return true; }
  modal({ title: t('Apply changes?'), body: el('p', {}, t('{n} changed line(s) are not applied to the PDF yet.', { n: S.edits.length })), actions: [
    { label: t('Discard'), onClick: () => { discardEdits(); S.api.setTool(next, true); } },
    { label: t('Apply'), primary: true, onClick: () => { applyEdits().then(() => S.api.setTool(next, true)); } }] });
  return false;
}

// ------------------------------------------------------------ Text boxes (annotation kind "texts", burned in on saving)
export function makeTextEl(n, x) {
  const d = el('div', { class: 'txtBox', 'data-ann': x.id, 'data-kind': 'texts', 'data-page': n });
  const place = () => { d.style.cssText = `left:${x.x * 100}%;top:${x.y * 100}%;font-size:calc(var(--scale-factor) * ${x.size}px);color:${x.color};font-weight:${x.bold ? 700 : 400}`; };
  place(); d.textContent = x.text;
  const startEdit = () => {
    if (S.tool === 'erase') return;
    d.contentEditable = 'plaintext-only'; d.classList.add('editing'); d.focus();
    const sel = getSelection(); sel.selectAllChildren(d); sel.collapseToEnd();
  };
  d.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit(); });
  d.addEventListener('blur', () => {
    if (d.contentEditable !== 'plaintext-only' && d.contentEditable !== 'true') return;
    d.contentEditable = 'false'; d.classList.remove('editing');
    const text = d.innerText.replace(/\n$/, '');
    if (!text.trim()) S.api.removeItem('texts', n, x.id); else if (text !== x.text) S.api.updateItem('texts', n, x.id, { text });
  });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); d.blur(); } e.stopPropagation(); });
  // Move by dragging (not while typing)
  d.addEventListener('pointerdown', (e) => {
    if (d.classList.contains('editing') || e.button !== 0 || S.tool === 'erase') return;
    e.preventDefault(); e.stopPropagation();
    const pr = d.closest('.page').getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { x: x.x, y: x.y }; let moved = false;
    d.setPointerCapture(e.pointerId);
    const mv = (ev) => { const dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height; if (Math.abs(dx) + Math.abs(dy) > 0.002) moved = true; x.x = Math.min(0.98, Math.max(0, o.x + dx)); x.y = Math.min(0.98, Math.max(0, o.y + dy)); place(); };
    const up = () => { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); if (moved) { const nx = x.x, ny = x.y; x.x = o.x; x.y = o.y; S.api.updateItem('texts', n, x.id, { x: nx, y: ny }); } else if (S.tool === 'text') startEdit(); };
    d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up);
  });
  d.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    S.api.showMenu(e.clientX, e.clientY, [
      { l: t('Edit'), ic: 'editText', f: startEdit },
      { l: x.bold ? t('Normal weight') : t('Bold'), ic: 'bold', f: () => S.api.updateItem('texts', n, x.id, { bold: !x.bold }) },
      ...[10, 12, 16, 22, 32].map((s) => ({ l: t('Size {n} pt', { n: s }), ic: x.size === s ? 'check' : null, f: () => S.api.updateItem('texts', n, x.id, { size: s }) })),
      '-',
      { swatches: TEXT_COLORS, cur: x.color, label: t('Color'), f: (c) => S.api.updateItem('texts', n, x.id, { color: c }) },
      '-',
      { l: t('Duplicate'), ic: 'duplicate', f: () => S.api.addItem('texts', n, { ...x, id: uid(), y: Math.min(0.95, x.y + 0.03) }) },
      { l: t('Delete'), ic: 'trash', k: 'Del', f: () => S.api.removeItem('texts', n, x.id) }
    ]);
  });
  if (x._new) { delete x._new; setTimeout(startEdit, 0); }
  return d;
}
function onTextClick(e) {
  if (S.tool !== 'text' || e.button !== 0 || e.target.closest('.txtBox')) return;
  const pe = e.target.closest('.page'); if (!pe) return;
  const [x, y] = posIn(pe, e), item = { id: uid(), x, y: Math.max(0, y - (S.txt.size * 0.6) / (S.pages[+pe.dataset.page - 1].h)), text: '', size: S.txt.size, color: S.txt.color, bold: S.txt.bold };
  // Add without undo entry first: an empty box disappears again on blur; the text is recorded when it is written
  item._new = true; S.api.addItem('texts', +pe.dataset.page, item);
}

// ------------------------------------------------------------ Images (annotation kind "imgs")
export function makeImgEl(n, s) {
  const box = el('div', { class: 'sigMark imgMark', 'data-ann': s.id, 'data-kind': 'imgs', 'data-page': n, title: t('Drag to move, corner to resize (keeps proportions); right-click for more') });
  const img = el('img', { src: s.img, draggable: false }), handle = el('i', { class: 'sigHandle' });
  const del = el('button', { class: 'boxDel', type: 'button', title: t('Remove image (Del)'), html: '&times;', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); S.api.removeItem('imgs', n, s.id); } });
  box.append(img, handle, del);
  const place = (q) => { box.style.cssText = `left:${q.x * 100}%;top:${q.y * 100}%;width:${q.w * 100}%;height:${q.h * 100}%`; };
  place(s);
  const drag = (resize) => (e) => {
    if (S.tool === 'erase' || e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const pr = box.closest('.page').getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { x: s.x, y: s.y, w: s.w, h: s.h }, q = { ...o };
    box.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height;
      if (resize) { q.w = Math.min(1 - o.x, Math.max(0.03, o.w + dx)); q.h = q.w * o.h / o.w; }
      else { q.x = Math.min(1 - o.w, Math.max(0, o.x + dx)); q.y = Math.min(1 - o.h, Math.max(0, o.y + dy)); }
      place(q);
    };
    const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); if (q.x !== o.x || q.y !== o.y || q.w !== o.w) S.api.updateItem('imgs', n, s.id, { x: q.x, y: q.y, w: q.w, h: q.h }); };
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
  };
  handle.addEventListener('pointerdown', drag(true)); img.addEventListener('pointerdown', drag(false));
  box.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    S.api.showMenu(e.clientX, e.clientY, [
      { l: t('Replace image …'), ic: 'image', f: () => pickImage((png) => S.api.updateItem('imgs', n, s.id, { img: png })) },
      { l: t('Duplicate'), ic: 'duplicate', f: () => S.api.addItem('imgs', n, { ...s, id: uid(), x: Math.min(1 - s.w, s.x + 0.03), y: Math.min(1 - s.h, s.y + 0.03) }) },
      { l: t('Delete'), ic: 'trash', k: 'Del', f: () => S.api.removeItem('imgs', n, s.id) }
    ]);
  });
  return box;
}
/** Opens a file picker and hands over the picture as PNG/JPEG data URL (large photos are scaled down to 2400 px). */
export function pickImage(then) {
  const f = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  f.onchange = () => {
    const file = f.files[0]; if (!file) return;
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 2400 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const jpeg = /jpe?g/i.test(file.type); then(c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), c.width / c.height); f.remove();
    };
    im.src = URL.createObjectURL(file);
  };
  document.body.append(f); f.click();
}
function onImageClick(e) {
  if (S.tool !== 'image' || e.button !== 0 || e.target.closest('.imgMark,.sigMark')) return;
  const pe = e.target.closest('.page'); if (!pe || !S.placeImg) return;
  const [cx, cy] = posIn(pe, e), b = pe.getBoundingClientRect(), w = 0.35, h = w * (b.width / b.height) / S.placeImg.ratio;
  S.api.addItem('imgs', +pe.dataset.page, { id: uid(), x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h, img: S.placeImg.src });
  toast(t('Image placed. Drag to move, corner to resize. It is burned in when you save.'), 4500);
}
export function chooseImage() { pickImage((src, ratio) => { S.placeImg = { src, ratio }; S.api.renderToolOpts(); }); }

// ------------------------------------------------------------ Tool options
export function editOpts(tool, o) {
  if (tool === 'edit') {
    const n = S.edits.length;
    o.append(el('span', { class: 'ico', html: icon('editText') }),
      el('span', {}, n ? t('{n} line(s) changed – not applied yet.', { n }) : t('Click on a line of text, change it, press Enter.')),
      el('button', { class: 'pillBtn primary', disabled: !n, onclick: applyEdits }, t('Apply changes')),
      el('button', { class: 'pillBtn', disabled: !n, onclick: discardEdits }, t('Discard')),
      el('span', { class: 'muted' }, t('The old text is really removed from the file, not just covered. Undo with Ctrl+Z.')));
    return true;
  }
  if (tool === 'text') {
    o.append(el('span', {}, t('Click on the page to write.')),
      el('label', { class: 'inl' }, t('Size'), el('select', { onchange: (e) => { S.txt.size = +e.target.value; } }, ...[8, 10, 12, 14, 16, 20, 24, 32, 48].map((s) => el('option', { value: s, selected: s === S.txt.size }, s + ' pt')))),
      ...TEXT_COLORS.map((c) => el('button', { class: 'swatch' + (c === S.txt.color ? ' on' : ''), style: `background:${c}`, title: t('Color'), onclick: () => { S.txt.color = c; S.api.renderToolOpts(); } })),
      el('button', { class: 'tb icon' + (S.txt.bold ? ' active' : ''), title: t('Bold'), html: icon('bold'), onclick: () => { S.txt.bold = !S.txt.bold; S.api.renderToolOpts(); } }),
      el('span', { class: 'muted' }, t('Double-click a text box to change it, drag to move it.')));
    return true;
  }
  if (tool === 'image') {
    o.append(S.placeImg ? el('img', { class: 'imgPrev', src: S.placeImg.src, alt: '' }) : null,
      el('span', {}, S.placeImg ? t('Click on the page to place the image.') : t('Choose an image first.')),
      el('button', { class: 'pillBtn' + (S.placeImg ? '' : ' primary'), onclick: chooseImage }, S.placeImg ? t('Other image …') : t('Choose image …')));
    if (!S.placeImg) setTimeout(chooseImage, 50);
    return true;
  }
  return false;
}

export function initEdit() {
  const v = $('#viewer');
  v.addEventListener('pointermove', onHover);
  v.addEventListener('pointerleave', () => hoverEl?.remove());
  v.addEventListener('click', (e) => { onEditClick(e); onTextClick(e); onImageClick(e); });
  S.api.drawStaged = drawStaged;
  S.api.resetLines = () => lineCache.clear();
}
