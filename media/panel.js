// Sidebar with tabs: pages (thumbnails), highlights & comments, search, contents (outline).
import { S, $, $$, el, icon, toast, modal } from './util.js';
import { t } from './i18n.js';

const COLOR_NAMES = () => ({ '#fff176': t('Yellow'), '#a5f3a0': t('Green'), '#8fd3ff': t('Blue'), '#ffadd2': t('Pink'), '#e53935': t('Red'), '#1e88e5': t('Blue'), '#212121': t('Black'), '#43a047': t('Green') });
const KIND = () => ({ hl: t('Highlight'), ul: t('Underline'), st: t('Strike through'), notes: t('Comment'), texts: t('Text'), ink: t('Drawing'), sigs: t('Signature'), imgs: t('Image') });
S.view = S.view || {};

// ------------------------------------------------------------ Tabs and width
export function showPane(name, focus) {
  const col = $('#sideCol'); col.classList.remove('hidden');
  $$('.stab').forEach((b) => { const on = b.dataset.pane === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $$('#sideCol .pane').forEach((p) => { p.hidden = p.id !== 'pane-' + name; });
  S.pane = name; col.dataset.pane = name;
  col.style.width = name === 'pages' ? '' : (S.view.sideW || 300) + 'px';
  if (name === 'marks') renderMarks();
  if (name === 'search') { buildSearch(); if (focus) { const i = $('#searchInput'); i.focus(); i.select(); } }
  if (name === 'outline') buildOutline();
  paintHits(); // search matches are only shown while the search tab is open
}
function initTabs() {
  $$('.stab').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane, true)));
  const grip = $('#sideGrip'), col = $('#sideCol');
  grip.addEventListener('pointerdown', (e) => {
    if (S.pane === 'pages') return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = col.offsetWidth;
    const mv = (ev) => { col.style.width = Math.max(220, Math.min(640, w0 + ev.clientX - x0)) + 'px'; };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); S.view.sideW = col.offsetWidth; S.api.saveView?.(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
}

// ------------------------------------------------------------ Highlights & comments
const filt = { kind: 'all', color: null, q: '' };
function entries() {
  const out = [];
  Object.keys(S.ann).map(Number).sort((a, b) => a - b).forEach((n) => {
    const a = S.ann[n] || {};
    (a.hl || []).forEach((h) => { if (h.text === '…') return; out.push({ n, kind: 'hl', sub: h.style || 'hl', item: h, text: h.text || '', note: h.note || '', color: h.color, rect: h.rects?.[0] }); });
    (a.notes || []).forEach((x) => out.push({ n, kind: 'notes', item: x, text: x.text, rect: [x.x, x.y, 0.02, 0.02] }));
    (a.texts || []).forEach((x) => out.push({ n, kind: 'texts', item: x, text: x.text, color: x.color, rect: [x.x, x.y, 0.1, 0.03] }));
    (a.ink || []).forEach((x) => { const xs = x.pts.map((p) => p[0]), ys = x.pts.map((p) => p[1]); out.push({ n, kind: 'ink', item: x, text: '', color: x.color, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] }); });
    (a.sigs || []).forEach((x) => out.push({ n, kind: 'sigs', item: x, text: '', rect: [x.x, x.y, x.w, x.h] }));
    (a.imgs || []).forEach((x) => out.push({ n, kind: 'imgs', item: x, text: '', rect: [x.x, x.y, x.w, x.h] }));
  });
  return out;
}
const KIND_FILTERS = () => [['all', t('All')], ['hl', t('Highlights')], ['notes', t('Comments')], ['texts', t('Text')], ['ink', t('Drawings')]];

export function marksAsMarkdown(list = entries()) {
  const out = [`# ${t('Highlights')}: ${S.name}`, ''];
  let last = 0;
  for (const e of list) {
    if (e.n !== last) { out.push('', `## ${t('Page {n}', { n: e.n })}`, ''); last = e.n; }
    if (e.kind === 'hl') out.push(`- ${e.sub === 'st' ? '~~' : ''}“${e.text}”${e.sub === 'st' ? '~~' : ''}` + (e.note ? ` – ${e.note}` : ''));
    else if (e.kind === 'notes') out.push(`- 💬 ${e.text}`);
    else if (e.kind === 'texts') out.push(`- ✎ ${e.text}`);
    else out.push(`- ${KIND()[e.kind]}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
const csvCell = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
function exportMarks(fmt) {
  const list = entries(), base = S.name.replace(/\.pdf$/i, '');
  let content;
  if (fmt === 'md') content = marksAsMarkdown(list);
  else if (fmt === 'csv') content = '﻿' + [['page', 'type', 'color', 'text', 'note'].join(';'), ...list.map((e) => [e.n, e.kind === 'hl' ? e.sub : e.kind, COLOR_NAMES()[e.color] || e.color || '', e.text, e.note || ''].map(csvCell).join(';'))].join('\r\n');
  else content = JSON.stringify(list.map((e) => ({ page: e.n, type: e.kind === 'hl' ? e.sub : e.kind, color: e.color || null, text: e.text || null, note: e.note || null, box: e.rect?.map((v) => +v.toFixed(4)) })), null, 2);
  S.api.request({ type: 'exportText', ext: fmt, suggested: `${base}_${t('highlights')}.${fmt}`, content }).then((r) => { if (r.ok) toast(t('Saved: {names}', { names: r.name }), 4000); });
}

let marksT = null;
export function scheduleMarks() { clearTimeout(marksT); marksT = setTimeout(() => { updateCount(); if (S.pane === 'marks') renderMarks(); }, 120); }
function updateCount() { const n = entries().length, c = $('#marksCnt'); if (c) { c.textContent = n ? String(n) : ''; c.hidden = !n; } }

function editNote(e) {
  const ta = el('textarea', { rows: 4, placeholder: t('Your note on this passage …') }); ta.value = e.item.note || '';
  modal({ title: t('Note on the highlight'), body: el('div', { class: 'stack' }, el('blockquote', { class: 'quote' }, e.text), ta), actions: [{ label: t('Cancel') }, { label: t('Save'), primary: true, onClick: () => { S.api.updateItem('hl', e.n, e.item.id, { note: ta.value.trim() || undefined }); } }] });
  setTimeout(() => ta.focus(), 30);
}

export function renderMarks() {
  const pane = $('#pane-marks'); if (!pane) return;
  const all = entries(), q = filt.q.trim().toLowerCase();
  const colors = [...new Set(all.filter((e) => e.kind === 'hl').map((e) => e.color))];
  const list = all.filter((e) => (filt.kind === 'all' || e.kind === filt.kind) && (!filt.color || e.color === filt.color) && (!q || (e.text + ' ' + (e.note || '')).toLowerCase().includes(q)));
  const keepFocus = document.activeElement?.id === 'marksQ';
  const search = el('input', { id: 'marksQ', type: 'search', placeholder: t('Filter …'), value: filt.q, oninput: (ev) => { filt.q = ev.target.value; renderMarks(); } });
  const head = el('div', { class: 'phead' },
    el('div', { class: 'ptitle' }, el('b', {}, t('Highlights')), el('span', { class: 'muted' }, list.length === all.length ? String(all.length) : `${list.length} / ${all.length}`)),
    el('div', { class: 'pacts' },
      el('button', { class: 'pillBtn sm', title: t('Copy all as Markdown'), disabled: !all.length, onclick: async () => { try { await navigator.clipboard.writeText(marksAsMarkdown(list)); toast(t('Copied'), 1500); } catch (e) { /* ignore */ } } }, el('span', { class: 'mic', html: icon('copy') }), t('Copy')),
      el('button', { class: 'pillBtn sm', disabled: !all.length, onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); S.api.showMenu(r.left, r.bottom + 4, [{ l: t('Markdown (.md)'), ic: 'markdown', f: () => exportMarks('md') }, { l: t('Table (.csv, Excel)'), ic: 'table', f: () => exportMarks('csv') }, { l: t('Data (.json)'), ic: 'json', f: () => exportMarks('json') }]); } }, el('span', { class: 'mic', html: icon('download') }), t('Export')),
      el('button', { class: 'pillBtn sm primary', disabled: !all.length, title: t('Let the AI build something from your highlights'), onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); S.api.showMenu(r.left, r.bottom + 4, aiMenu()); } }, el('span', { class: 'mic', html: icon('spark') }), S.ai?.name || 'AI')),
    search,
    el('div', { class: 'chips' },
      ...KIND_FILTERS().map(([k, l]) => el('button', { class: 'chip' + (filt.kind === k ? ' on' : ''), onclick: () => { filt.kind = k; renderMarks(); } }, l)),
      ...colors.map((c) => el('button', { class: 'chip dot' + (filt.color === c ? ' on' : ''), title: COLOR_NAMES()[c] || c, style: `--c:${c}`, onclick: () => { filt.color = filt.color === c ? null : c; renderMarks(); } }))));
  const body = el('div', { class: 'plist' });
  if (!all.length) body.append(el('div', { class: 'empty' }, el('span', { class: 'bigic', html: icon('marker') }), el('p', {}, t('No highlights yet.')), el('p', { class: 'muted' }, t('Select text and pick a color, or press H for the highlighter. Everything you mark shows up here – click an entry to jump to it.'))));
  else if (!list.length) body.append(el('p', { class: 'muted empty' }, t('Nothing matches the filter.')));
  let last = 0;
  for (const e of list) {
    if (e.n !== last) { body.append(el('div', { class: 'pgroup' }, t('Page {n}', { n: e.n }))); last = e.n; }
    const kindLabel = e.kind === 'hl' ? KIND()[e.sub] : KIND()[e.kind];
    const row = el('div', { class: 'mrk k-' + e.kind + (e.sub ? ' s-' + e.sub : ''), tabindex: '0', style: e.color ? `--c:${e.color}` : '', title: t('Click to jump there'),
      onclick: () => S.api.reveal(e.n, e.rect),
      onkeydown: (ev) => { if (ev.key === 'Enter') S.api.reveal(e.n, e.rect); if (ev.key === 'Delete') S.api.removeItem(e.kind, e.n, e.item.id); },
      ondblclick: () => { if (e.kind === 'hl') editNote(e); } },
      el('i', { class: 'bar' }),
      el('div', { class: 'mbody' },
        e.text ? el('div', { class: 'mtext' }, e.text) : el('div', { class: 'mtext muted' }, kindLabel),
        e.note ? el('div', { class: 'mnote' }, el('span', { class: 'mic', html: icon('comment') }), e.note) : null,
        el('div', { class: 'mmeta' }, kindLabel)),
      el('div', { class: 'macts' },
        e.kind === 'hl' ? el('button', { class: 'tb icon', title: t('Note'), html: icon('comment'), onclick: (ev) => { ev.stopPropagation(); editNote(e); } }) : null,
        e.text ? el('button', { class: 'tb icon', title: t('Copy'), html: icon('copy'), onclick: async (ev) => { ev.stopPropagation(); try { await navigator.clipboard.writeText(e.text); toast(t('Copied'), 1200); } catch (x) { /* ignore */ } } }) : null,
        el('button', { class: 'tb icon', title: t('Delete'), html: icon('trash'), onclick: (ev) => { ev.stopPropagation(); S.api.removeItem(e.kind, e.n, e.item.id); } })));
    body.append(row);
  }
  pane.replaceChildren(head, body);
  if (keepFocus) { const i = $('#marksQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  updateCount();
}
function aiMenu() {
  const ask = (k) => S.api.askClaude(k);
  return [
    { l: t('Study sheet from my highlights'), ic: 'book', f: () => ask('marks-notes') },
    { l: t('Mind map from my highlights'), ic: 'outline', f: () => ask('marks-mindmap') },
    { l: t('Summary of my highlights'), ic: 'list', f: () => ask('marks-summary') },
    { l: t('Flashcards from my highlights …'), ic: 'cards', f: () => S.api.countDialog('cards', t('Create flashcards')) },
    '-',
    { l: t('Practice flashcards now (offline)'), ic: 'cards', f: () => $('#tCards').click() }
  ];
}

// ------------------------------------------------------------ Search
const srch = { q: '', hits: [], i: -1, matchCase: false, busy: false };
const norm = (s, mc) => (mc ? s : s.toLowerCase());
function buildSearch() {
  const pane = $('#pane-search'); if (pane.dataset.built) return; pane.dataset.built = '1';
  const input = el('input', { id: 'searchInput', type: 'search', placeholder: t('Search in the PDF …') });
  const info = el('div', { class: 'muted', id: 'searchInfo' }, t('Enter = next match, Shift+Enter = previous'));
  const mc = el('button', { class: 'chip', title: t('Match case'), onclick: () => { srch.matchCase = !srch.matchCase; mc.classList.toggle('on', srch.matchCase); run(); } }, 'Aa');
  const prev = el('button', { class: 'tb icon', title: t('Previous match'), onclick: () => step(-1) }, '↑'), next = el('button', { class: 'tb icon', title: t('Next match'), onclick: () => step(1) }, '↓');
  let tm = null;
  input.addEventListener('input', () => { clearTimeout(tm); srch.done = false; tm = setTimeout(run, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(tm); if (srch.q !== input.value || !srch.done) run().then(() => step(0)); else step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { input.value = ''; run(); } });
  pane.append(el('div', { class: 'phead' }, el('div', { class: 'ptitle' }, el('b', {}, t('Search'))), el('div', { class: 'srow' }, input, mc, prev, next), info), el('div', { class: 'plist', id: 'searchList' }));
}
async function run() {
  const input = $('#searchInput'), q = input.value.trim(); srch.q = input.value; srch.hits = []; srch.i = -1;
  clearHits();
  const list = $('#searchList'), info = $('#searchInfo'); list.replaceChildren();
  if (q.length < 2) { info.textContent = q ? t('At least 2 characters.') : t('Enter = next match, Shift+Enter = previous'); return; }
  info.textContent = t('Searching …');
  const needle = norm(q, srch.matchCase);
  for (const p of S.pages) {
    const tc = await S.api.textContent(p.n); let str = ''; const map = [];
    tc.items.forEach((it, k) => { for (let j = 0; j < it.str.length; j++) map.push([k, j]); str += it.str; if (it.hasEOL) { str += ' '; map.push([k, -1]); } });
    const hay = norm(str, srch.matchCase); let from = 0, idx;
    while ((idx = hay.indexOf(needle, from)) >= 0) {
      srch.hits.push({ n: p.n, rects: rectsFor(p, tc, map, idx, needle.length), snip: [str.slice(Math.max(0, idx - 40), idx), str.slice(idx, idx + needle.length), str.slice(idx + needle.length, idx + needle.length + 50)] });
      from = idx + needle.length; if (srch.hits.length > 2000) break;
    }
    if (srch.q !== input.value) return; // a newer search started
  }
  srch.done = true;
  const pages = new Set(srch.hits.map((h) => h.n)).size;
  info.textContent = srch.hits.length ? t('{n} matches on {p} pages', { n: srch.hits.length, p: pages }) : t('No matches.');
  let last = 0;
  srch.hits.forEach((h, i) => {
    if (h.n !== last) { list.append(el('div', { class: 'pgroup' }, t('Page {n}', { n: h.n }))); last = h.n; }
    list.append(el('div', { class: 'hit', 'data-i': i, tabindex: '0', onclick: () => go(i) }, (h.snip[0].length >= 40 ? '…' : '') + h.snip[0], el('mark', {}, h.snip[1]), h.snip[2] + '…'));
  });
  paintHits();
}
// Rectangles of a match (normalized 0..1 of the displayed page) from the pdf.js text items
function rectsFor(p, tc, map, idx, len) {
  const vp = p.page.getViewport({ scale: 1 }), byItem = new Map();
  for (let k = idx; k < idx + len; k++) { const m = map[k]; if (!m || m[1] < 0) continue; const r = byItem.get(m[0]) || byItem.set(m[0], [m[1], m[1]]).get(m[0]); r[0] = Math.min(r[0], m[1]); r[1] = Math.max(r[1], m[1]); }
  const out = [];
  for (const [k, [a, b]] of byItem) {
    const it = tc.items[k], tr = it.transform, L = Math.max(1, it.str.length), h = Math.hypot(tr[2], tr[3]) || it.height || 10;
    const ux = tr[0] / (Math.hypot(tr[0], tr[1]) || 1), uy = tr[1] / (Math.hypot(tr[0], tr[1]) || 1), x0 = it.width * a / L, x1 = it.width * (b + 1) / L;
    const pts = [[x0, -0.22 * h], [x1, -0.22 * h], [x0, 0.88 * h], [x1, 0.88 * h]].map(([dx, dy]) => vp.convertToViewportPoint(tr[4] + dx * ux - dy * uy, tr[5] + dx * uy + dy * ux));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    out.push([Math.min(...xs) / vp.width, Math.min(...ys) / vp.height, (Math.max(...xs) - Math.min(...xs)) / vp.width, (Math.max(...ys) - Math.min(...ys)) / vp.height]);
  }
  return out;
}
function clearHits() { $$('.srchHit').forEach((x) => x.remove()); }
export function paintHits() {
  clearHits(); if (!srch.hits.length || S.pane !== 'search') return;
  srch.hits.forEach((h, i) => {
    const p = S.pages[h.n - 1]; if (!p) return;
    h.rects.forEach((r) => { const d = el('div', { class: 'srchHit' + (i === srch.i ? ' cur' : '') }); d.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%`; p.el.append(d); });
  });
}
function go(i) {
  if (!srch.hits.length) return; srch.i = (i + srch.hits.length) % srch.hits.length;
  const h = srch.hits[srch.i]; S.api.reveal(h.n, h.rects[0], true); paintHits();
  $$('#searchList .hit').forEach((x) => x.classList.toggle('cur', +x.dataset.i === srch.i));
  $(`#searchList .hit[data-i="${srch.i}"]`)?.scrollIntoView({ block: 'nearest' });
  $('#searchInfo').textContent = t('Match {i} of {n}', { i: srch.i + 1, n: srch.hits.length });
}
function step(d) { if (!srch.hits.length) return; go(d === 0 ? 0 : srch.i + d); }

// ------------------------------------------------------------ Contents (outline)
async function buildOutline() {
  const pane = $('#pane-outline'); if (pane.dataset.doc === String(S.docId)) return; pane.dataset.doc = String(S.docId);
  pane.replaceChildren(el('div', { class: 'phead' }, el('div', { class: 'ptitle' }, el('b', {}, t('Contents')))));
  let ol = null; try { ol = await S.pdf.getOutline(); } catch (e) { /* none */ }
  if (!ol || !ol.length) { pane.append(el('div', { class: 'empty' }, el('span', { class: 'bigic', html: icon('outline') }), el('p', {}, t('This PDF has no table of contents (bookmarks).')), el('p', { class: 'muted' }, t('Use the search or your highlights to find your way around.')))); return; }
  const target = async (dest) => {
    try {
      if (typeof dest === 'string') dest = await S.pdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const n = typeof dest[0] === 'object' ? (await S.pdf.getPageIndex(dest[0])) + 1 : (dest[0] | 0) + 1;
      let y = null; const p = S.pages[n - 1];
      if (p && dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') { const vp = p.page.getViewport({ scale: 1 }); y = vp.convertToViewportPoint(dest[2] || 0, dest[3])[1] / vp.height; }
      return { n, y };
    } catch (e) { return null; }
  };
  const tree = (items, depth) => el('ul', { class: 'otree' + (depth ? ' sub' : '') }, ...items.map((it) => {
    const kids = it.items?.length ? tree(it.items, depth + 1) : null;
    const tog = kids ? el('button', { class: 'otog', 'aria-label': t('Expand'), onclick: (e) => { e.stopPropagation(); li.classList.toggle('closed'); } }, '▾') : el('span', { class: 'otog' });
    const li = el('li', { class: depth > 0 ? 'closed' : '' }, el('div', { class: 'orow', tabindex: '0', onclick: async () => { const d = await target(it.dest); if (d) S.api.reveal(d.n, d.y != null ? [0, d.y, 1, 0.02] : null); else if (it.url) toast(it.url); } }, tog, el('span', {}, it.title)), kids);
    return li;
  }));
  pane.append(el('div', { class: 'plist' }, tree(ol, 0)));
}

export function initPanel() {
  initTabs();
  S.api.scheduleMarks = scheduleMarks; S.api.paintHits = paintHits; S.api.showPane = showPane;
  $('#tMarks').onclick = () => (S.pane === 'marks' && !$('#sideCol').classList.contains('hidden') ? showPane('pages') : showPane('marks'));
  $('#tSearch').onclick = () => showPane('search', true);
  S.pane = 'pages';
}
