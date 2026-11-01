// Toolbar layout: the user decides which elements appear, in which order, with or without labels.
// Layout = list of ids: element ids (data-bar), '|' = separator, '>' = from here on aligned right, 'q:<tool>' = a tool from the Tools menu.
// Change it by dragging buttons in the bar, by right-click or in the dialog "Customize toolbar".
import { S, $, $$, el, icon, modal } from './util.js';
import { t } from './i18n.js';

export const DEFAULT_BAR = ['side', 'page', '|', 'zoom', '|', 'hl', 'note', 'draw', 'text', 'edit', 'image', 'erase', '|', 'undo', 'redo', '|', 'cards', 'tools', 'ai', '>', 'search', 'marks', 'print', 'mail', 'file'];
const SEP = '|', GROW = '>';
S.bar = { items: DEFAULT_BAR.slice(), labels: 'auto' };

const post = () => S.api.post({ type: 'saveBar', bar: S.bar });
const coreEl = (id) => $(`#bar [data-bar="${id}"], #barStore [data-bar="${id}"]`);
const allCore = () => [...new Set($$('#bar [data-bar], #barStore [data-bar]').map((e) => e.dataset.bar))];

/** Name and icon of an element (for menus and the dialog). */
export function itemInfo(id) {
  if (id === SEP) return { l: t('Separator'), ic: 'minus' };
  if (id === GROW) return { l: t('Space (everything after it on the right)'), ic: 'chevron' };
  if (id.startsWith('q:')) { const d = (S.api.toolDefs?.() || []).find((x) => x.id === id.slice(2)); return d ? { l: d.l.replace(/ …$/, ''), ic: d.ic } : null; }
  const e = coreEl(id); if (!e) return null;
  const names = { page: t('Page number'), zoom: t('Zoom') };
  const l = names[id] || e.querySelector('.lbl')?.textContent || (e.getAttribute('title') || id).replace(/ \(.*\)$/, '').replace(/ …$/, '');
  return { l, ic: { zoom: 'search', page: 'file' }[id] || e.querySelector('[data-i]')?.dataset.i || 'file' };
}

function quickButton(id) {
  const d = (S.api.toolDefs?.() || []).find((x) => x.id === id.slice(2)); if (!d) return null;
  const name = d.l.replace(/ …$/, '');
  const b = el('button', { class: 'tb icon quickBtn', type: 'button', 'data-quick': id, title: name, 'aria-label': name, html: icon(d.ic), onclick: () => d.f() });
  if (d.tool) { b.dataset.tool = d.tool; b.classList.toggle('active', d.tool === S.tool); }
  return b;
}

/** Arranges the toolbar according to S.bar. */
export function applyBar() {
  const bar = $('#bar'), store = $('#barStore');
  allCore().forEach((id) => store.append(coreEl(id)));
  bar.replaceChildren();
  let seg = null;
  for (const id of S.bar.items) {
    let node;
    if (id === SEP) node = el('div', { class: 'sep' });
    else if (id === GROW) node = el('span', { class: 'grow' });
    else if (id.startsWith('q:')) node = quickButton(id);
    else node = coreEl(id);
    if (!node) continue;
    node.dataset.slot = id;
    if (node.dataset.tool && !node.dataset.quick) { // tool buttons side by side share one pill
      if (!seg || seg !== bar.lastChild) { seg = el('div', { class: 'seg' }); bar.append(seg); }
      seg.append(node); continue;
    }
    bar.append(node);
  }
  document.body.classList.toggle('lbl-on', S.bar.labels === 'on');
  document.body.classList.toggle('lbl-off', S.bar.labels === 'off');
  fitBar();
  $$('#bar [data-slot]').forEach((n) => {
    if (n.dataset.slot === 'page') return; // the page field stays an input field, not a drag handle
    n.draggable = true;
  });
}

// "Automatic" labels: shown while everything fits, otherwise icons only (the AI button keeps its name)
export function fitBar() {
  const bar = $('#bar'); document.body.classList.remove('lbl-compact');
  if (S.bar.labels === 'auto' && bar.scrollWidth > bar.clientWidth + 2) document.body.classList.add('lbl-compact');
}
let fitT = null; window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitBar, 120); });

function setItems(items) { S.bar.items = items; remember(); applyBar(); post(); }
export function hideItem(id) { const items = S.bar.items.slice(), i = items.indexOf(id); if (i >= 0) items.splice(i, 1); setItems(items); }
export function toggleQuick(toolId) {
  const id = 'q:' + toolId;
  if (S.bar.items.includes(id)) setItems(S.bar.items.filter((x) => x !== id));
  else { const items = S.bar.items.slice(), g = items.indexOf(GROW); items.splice(g < 0 ? items.length : g, 0, id); setItems(items); }
}
export const isPinned = (toolId) => S.bar.items.includes('q:' + toolId);

/** Loads the saved layout (or the default) and takes over pins from older versions (quick bar). */
export function initBar(saved, oldQuick = []) {
  if (saved && Array.isArray(saved.items)) {
    S.bar = { items: saved.items.filter((x) => typeof x === 'string'), labels: ['auto', 'on', 'off'].includes(saved.labels) ? saved.labels : 'auto' };
    // Elements added in a newer version appear at their default place
    const known = new Set([...S.bar.items, ...(saved.hidden || [])]);
    DEFAULT_BAR.forEach((id, i) => { if (id !== SEP && id !== GROW && !known.has(id)) { const before = DEFAULT_BAR.slice(i + 1).find((x) => S.bar.items.includes(x)); const at = before ? S.bar.items.indexOf(before) : S.bar.items.length; S.bar.items.splice(at, 0, id); } });
  } else {
    S.bar = { items: DEFAULT_BAR.slice(), labels: 'auto' };
    const g = S.bar.items.indexOf(GROW);
    S.bar.items.splice(g, 0, ...oldQuick.map((q) => 'q:' + q));
  }
  applyBar();
  wireBar();
}
function remember() { S.bar.hidden = allCore().filter((id) => !S.bar.items.includes(id)); }

// ------------------------------------------------------------ Direct manipulation in the bar
let wired = false;
function wireBar() {
  if (wired) return; wired = true;
  const bar = $('#bar');
  let from = null;
  bar.addEventListener('dragstart', (e) => {
    const n = e.target.closest?.('[data-slot]'); if (!n || n.closest('#bar') !== bar) return;
    from = n.dataset.slot; e.dataTransfer.setData('text/plain', 'bar:' + from); e.dataTransfer.effectAllowed = 'move'; n.classList.add('dragging');
  });
  bar.addEventListener('dragend', () => { from = null; $$('#bar .dragging,#bar .dropL,#bar .dropR').forEach((x) => x.classList.remove('dragging', 'dropL', 'dropR')); });
  const target = (e) => { const n = e.target.closest?.('[data-slot]'); if (!n) return null; const r = n.getBoundingClientRect(); return { n, after: e.clientX > r.left + r.width / 2 }; };
  bar.addEventListener('dragover', (e) => {
    if (!from) return; e.preventDefault();
    $$('#bar .dropL,#bar .dropR').forEach((x) => x.classList.remove('dropL', 'dropR'));
    const tg = target(e); if (tg && tg.n.dataset.slot !== from) tg.n.classList.add(tg.after ? 'dropR' : 'dropL');
  });
  bar.addEventListener('drop', (e) => {
    if (!from) return; e.preventDefault();
    const tg = target(e); if (!tg || tg.n.dataset.slot === from) return;
    const items = S.bar.items.slice(), fi = items.indexOf(from); items.splice(fi, 1);
    let ti = items.indexOf(tg.n.dataset.slot); if (tg.after) ti++;
    items.splice(ti, 0, from); setItems(items);
  });
  bar.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input')) return;
    e.preventDefault();
    const n = e.target.closest('[data-slot]'), id = n?.dataset.slot, inf = id && itemInfo(id);
    S.api.showMenu(e.clientX, e.clientY, [
      ...(inf ? [{ l: t('Remove “{name}” from the toolbar', { name: inf.l }), ic: 'close', f: () => hideItem(id) }, '-'] : []),
      { l: t('Customize toolbar …'), ic: 'sliders', f: customizeDialog },
      '-',
      { l: t('Labels: automatic'), ic: S.bar.labels === 'auto' ? 'check' : null, f: () => { S.bar.labels = 'auto'; applyBar(); post(); } },
      { l: t('Labels: always'), ic: S.bar.labels === 'on' ? 'check' : null, f: () => { S.bar.labels = 'on'; applyBar(); post(); } },
      { l: t('Labels: icons only'), ic: S.bar.labels === 'off' ? 'check' : null, f: () => { S.bar.labels = 'off'; applyBar(); post(); } }
    ]);
  });
}

// ------------------------------------------------------------ Dialog
export function customizeDialog() {
  const work = S.bar.items.slice();
  const listOn = el('div', { class: 'barList', 'aria-label': t('In the toolbar') }), listOff = el('div', { class: 'barList off', 'aria-label': t('Available') });
  const labels = el('select', {}, ...[['auto', t('Automatic (hidden when space is short)')], ['on', t('Always show labels')], ['off', t('Icons only')]].map(([v, l]) => el('option', { value: v, selected: S.bar.labels === v }, l)));
  const live = () => { S.bar.items = work.slice(); S.bar.labels = labels.value; applyBar(); };
  labels.onchange = live;
  let dragI = null;
  const draw = () => {
    listOn.replaceChildren(...work.map((id, i) => {
      const inf = itemInfo(id) || { l: id, ic: 'close' }, special = id === SEP || id === GROW;
      const row = el('div', { class: 'barRow' + (special ? ' special' : ''), draggable: 'true' },
        el('span', { class: 'grip', html: icon('grip') }), el('span', { class: 'mic', html: icon(inf.ic) }), el('span', { class: 'bl' }, inf.l),
        el('button', { class: 'tb icon', title: t('Move up'), disabled: i === 0, onclick: () => { [work[i - 1], work[i]] = [work[i], work[i - 1]]; draw(); live(); } }, '↑'),
        el('button', { class: 'tb icon', title: t('Move down'), disabled: i === work.length - 1, onclick: () => { [work[i + 1], work[i]] = [work[i], work[i + 1]]; draw(); live(); } }, '↓'),
        el('button', { class: 'tb icon', title: t('Remove'), onclick: () => { work.splice(i, 1); draw(); live(); }, html: icon('close') }));
      row.addEventListener('dragstart', (e) => { dragI = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'row'); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { dragI = null; row.classList.remove('dragging'); });
      row.addEventListener('dragover', (e) => { if (dragI == null) return; e.preventDefault(); const r = row.getBoundingClientRect(); row.classList.toggle('dropB', e.clientY < r.top + r.height / 2); row.classList.toggle('dropA', e.clientY >= r.top + r.height / 2); });
      row.addEventListener('dragleave', () => row.classList.remove('dropA', 'dropB'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('dropA', 'dropB'); if (dragI == null || dragI === i) return;
        const r = row.getBoundingClientRect(), after = e.clientY >= r.top + r.height / 2, [it] = work.splice(dragI, 1);
        let to = i - (dragI < i ? 1 : 0) + (after ? 1 : 0); work.splice(to, 0, it); dragI = null; draw(); live();
      });
      return row;
    }));
    const unused = [...allCore().filter((id) => !work.includes(id)), ...(S.api.toolDefs?.() || []).map((d) => 'q:' + d.id).filter((id) => !work.includes(id))];
    listOff.replaceChildren(...(unused.length ? unused.map((id) => {
      const inf = itemInfo(id); if (!inf) return null;
      return el('div', { class: 'barRow' }, el('span', { class: 'mic', html: icon(inf.ic) }), el('span', { class: 'bl' }, inf.l),
        el('button', { class: 'pillBtn', onclick: () => { const g = work.indexOf(GROW); work.splice(g < 0 ? work.length : g, 0, id); draw(); live(); } }, t('Add')));
    }) : [el('p', { class: 'muted' }, t('Everything is in the toolbar.'))]));
  };
  draw();
  const body = el('div', { class: 'barDlg' },
    el('p', { class: 'muted' }, t('Drag the rows (or the buttons directly in the toolbar) to change the order. Right-click a button in the toolbar to remove it.')),
    el('div', { class: 'barCols' },
      el('div', {}, el('h4', {}, t('In the toolbar')), listOn,
        el('div', { class: 'row', style: 'justify-content:flex-start' },
          el('button', { class: 'pillBtn', onclick: () => { work.push(SEP); draw(); live(); } }, t('+ Separator')),
          el('button', { class: 'pillBtn', onclick: () => { if (!work.includes(GROW)) { work.push(GROW); draw(); live(); } } }, t('+ Right-align from here')))),
      el('div', {}, el('h4', {}, t('Available')), listOff, el('label', { class: 'fld' }, el('span', {}, t('Labels')), labels))));
  const before = { items: S.bar.items.slice(), labels: S.bar.labels };
  modal({ title: t('Customize toolbar'), wide: true, body, actions: [
    { label: t('Reset to default'), onClick: () => { work.splice(0, work.length, ...DEFAULT_BAR); labels.value = 'auto'; draw(); live(); return false; } },
    { label: t('Cancel'), onClick: () => { S.bar.items = before.items; S.bar.labels = before.labels; applyBar(); } },
    { label: t('Done'), primary: true, onClick: () => { live(); remember(); post(); } }
  ] });
}
