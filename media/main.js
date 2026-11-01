import * as pdfjsLib from './lib/pdf.min.mjs';
import { S, $, $$, el, icon, fillIcons, toast, modal, uid } from './util.js';
import { shapePolys } from './annots.js';
import { initBar, toggleQuick, isPinned, customizeDialog } from './bar.js';
import { initPanel, showPane } from './panel.js';
import { initEdit, editOpts, makeTextEl, makeImgEl, leaveEdit } from './edit.js';
import { initShare, copyDialog } from './share.js';
import { initPages, mergeDialog, splitDialog, compressDialog, cropDialog, numberDialog, insertFrom } from './pages.js';
import { initTools, makeSigEl, drawRed } from './tools.js';
import { b64ToBytes, toB64 } from './pages.js';
import { ocrDialog } from './ocr.js';
import { t, loadLang, applyI18n } from './i18n.js';
import { toPdf } from './convert.js';

const vscode = acquireVsCodeApi();
const cfg = JSON.parse($('#cfg').dataset.cfg);
await loadLang(cfg.lang);
const BASE = 96 / 72;
const HL_COLORS = ['#fff176', '#a5f3a0', '#8fd3ff', '#ffadd2'];
const PEN_COLORS = ['#e53935', '#1e88e5', '#212121', '#43a047'];
const LINE_COLORS = ['#e53935', '#1e88e5', '#43a047', '#212121'];   // underline / strike through: light highlight colors would be invisible as a line
S.hlStyle = 'hl'; S.ulColor = '#e53935'; S.shape = 'free'; S.eraseR = 10; S.docId = 0; S.tc = {};
const wrapEl = $('#wrap'), viewerEl = $('#viewer');
const post = (m) => vscode.postMessage(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fillIcons(); applyI18n();
document.title = cfg.name;
S.name = cfg.kind && cfg.kind !== 'pdf' ? cfg.pdfName : cfg.name; // Word/PowerPoint/image: the viewer works on (and saves) a PDF

// ------------------------------------------------------------ Loading
let initResolve; const initP = new Promise((r) => (initResolve = r));
let rid = 0; const pending = new Map();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m?.type === 'init') initResolve(m);
  else if (m?.type === 'reply') { pending.get(m.rid)?.(m); pending.delete(m.rid); progressCb.delete(m.rid); }
  else if (m?.type === 'progress') progressCb.get(m.rid)?.(m);
});
const progressCb = new Map();
const request = (msg, onProgress) => { let id; const p = new Promise((res) => { id = ++rid; pending.set(id, res); if (onProgress) progressCb.set(id, onProgress); post({ ...msg, rid: id }); }); p.rid = id; return p; };
post({ type: 'ready' });

function showMsg(t) { const m = $('#msg'); m.textContent = t || ''; m.hidden = !t; }

async function makeWorker() {
  const code = await (await fetch(cfg.mediaUri + '/lib/pdf.worker.min.mjs')).text();
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return new pdfjsLib.PDFWorker({ port: new Worker(url, { type: 'module' }) });
}

let textsReady = Promise.resolve();

let workerP = null;
async function loadDoc() {
  const worker = await (workerP ||= makeWorker());
  try { S.pdf?.destroy(); } catch (e) { /* ignore */ }
  io?.disconnect(); ioThumb?.disconnect(); viewerEl.replaceChildren(); S.pages = []; S.texts = []; S.tc = {}; S.docId++; S.api.resetLines?.();
  S.pdf = await pdfjsLib.getDocument({
    data: S.bytes.slice(), worker,
    cMapUrl: cfg.mediaUri + '/lib/cmaps/', cMapPacked: true,
    standardFontDataUrl: cfg.mediaUri + '/lib/standard_fonts/'
  }).promise;
  $('#pageCount').textContent = S.pdf.numPages;
  await buildPages();
}
// Rebuild after document changes (pages rotated, deleted, …) while keeping the view
async function reload() {
  const z = S.zoom, top = wrapEl.scrollTop, cur = S.cur;
  S.red = {}; S.edits = []; hideSel();
  await loadDoc();
  S.zoom = z; layoutPages(); S.pages.forEach((p) => renderAnn(p.n));
  wrapEl.scrollTop = top; S.cur = 0; setCur(Math.min(cur, S.pages.length));
  flushAnn(); markSelSafe(); S.api.scheduleMarks?.();
}
const markSelSafe = () => S.api.markSel && S.api.markSel();

// Image / Word / PowerPoint → PDF in memory; the result counts as unsaved (saving creates a new PDF)
async function convertFile(buf) {
  showMsg(t('Converting to PDF …'));
  const bytes = await toPdf(buf, cfg.kind, {
    media: cfg.mediaUri,
    onProgress: (n) => showMsg(t('Converting to PDF … page {n}', { n })),
    buildPdf: async (pages) => {
      const r = await request({ type: 'buildPdf', pages: pages.map((p) => ({ ...p, img: toB64(p.img) })) });
      if (!r.ok) throw new Error(r.error || 'buildPdf');
      return b64ToBytes(r.b64);
    }
  });
  S.converted = true; S.dirty = true;
  return bytes;
}

async function start() {
  showMsg(t('Loading PDF …'));
  try {
    const [buf, init] = await Promise.all([fetch(cfg.pdfUri).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }), initP]);
    S.bytes = cfg.kind && cfg.kind !== 'pdf' ? await convertFile(buf) : new Uint8Array(buf).slice();
    S.ann = init.ann || {}; S.sigs = Array.isArray(init.sigs) ? init.sigs : []; S.sigId = init.sigId || null; S.sig = (S.sigs.find((g) => g.id === S.sigId) || S.sigs[S.sigs.length - 1] || {}).png || init.sig || null; S.view = init.view || {}; applyView(); applyAi(init.ai); initBar(init.bar, Array.isArray(init.quick) ? init.quick : []);
    await loadDoc();
    showMsg('');
    fitWidth(true);
    S.pages.forEach((p) => renderAnn(p.n));
    S.api.scheduleMarks();
    if (S.converted) { S.api.updateDirty?.(); if (cfg.kind !== 'image') toast(t('Converted from “{name}” to PDF. The original stays unchanged; File → Save as PDF creates a new file.', { name: cfg.name }), 8000); }
    S.pdf.getPage(1).then((p) => p.getTextContent()).then((tc) => { if (!tc.items.some((i) => i.str && i.str.trim())) toast(t('This PDF looks like a scan (no text on page 1). Use Tools → "Text recognition (OCR)" to make it searchable.'), 9000); }).catch(() => {});
    if (!init.hasText) textsReady = (async () => { const t = await getAllTexts(); post({ type: 'saveText', texts: t }); })();
  } catch (e) {
    console.error(e);
    showMsg(S.converted === undefined && cfg.kind && cfg.kind !== 'pdf' ? t('Could not convert the file: {msg}', { msg: e.message || e }) : t('Could not open PDF: {msg}', { msg: e.message || e }));
  }
}

// ------------------------------------------------------------ Pages & rendering
const svgNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
let io = null, ioThumb = null;

async function buildPages() {
  const N = S.pdf.numPages, pages = [];
  for (let i = 0; i < N; i += 40) pages.push(...await Promise.all(Array.from({ length: Math.min(40, N - i) }, (_, k) => S.pdf.getPage(i + k + 1))));
  S.pages = pages.map((page, idx) => {
    const n = idx + 1, vp = page.getViewport({ scale: 1 });
    const cv = el('div', { class: 'cv' }), hlDiv = el('div', { class: 'hlLayer' });
    const ink = svgEl('svg', { class: 'inkLayer', viewBox: '0 0 1 1', preserveAspectRatio: 'none' }); ink.dataset.page = n;
    const textDiv = el('div', { class: 'textLayer' }), noteDiv = el('div', { class: 'noteLayer' }), redDiv = el('div', { class: 'redLayer' });
    const pe = el('div', { class: 'page', 'data-page': n }, cv, hlDiv, ink, textDiv, noteDiv, redDiv);
    viewerEl.append(pe);
    return { n, page, w: vp.width, h: vp.height, el: pe, cv, hlDiv, ink, textDiv, noteDiv, redDiv, rendered: false, rendering: false, token: 0, task: null };
  });
  io?.disconnect();
  io = new IntersectionObserver((entries) => entries.forEach((en) => { const rec = S.pages[+en.target.dataset.page - 1]; en.isIntersecting ? renderPage(rec) : unloadPage(rec); }), { root: wrapEl, rootMargin: '1400px 0px' });
  S.pages.forEach((p) => io.observe(p.el));
  buildThumbs();
}
function layoutPages() {
  const sc = S.zoom * BASE;
  S.pages.forEach((p) => {
    p.token++; try { p.task?.cancel(); } catch (e) {}
    p.rendered = false; p.rendering = false; p.cv.replaceChildren(); p.textDiv.replaceChildren();
    p.el.style.width = p.w * sc + 'px'; p.el.style.height = p.h * sc + 'px'; p.el.style.setProperty('--scale-factor', sc);
    io.unobserve(p.el); io.observe(p.el);
  });
  $('#zoomLabel').textContent = Math.round(S.zoom * 100) + ' %';
}
function unloadPage(rec) {
  if (!rec.rendered && !rec.rendering) return;
  rec.token++; try { rec.task?.cancel(); } catch (e) {}
  rec.cv.replaceChildren(); rec.textDiv.replaceChildren(); rec.rendered = false; rec.rendering = false;
}
async function renderPage(rec) {
  if (rec.rendered || rec.rendering) return;
  rec.rendering = true;
  const token = ++rec.token, sc = S.zoom * BASE, vp = rec.page.getViewport({ scale: sc });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
  try {
    rec.task = rec.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    await rec.task.promise;
    if (token !== rec.token) return;
    rec.cv.replaceChildren(canvas); rec.textDiv.replaceChildren();
    await new pdfjsLib.TextLayer({ textContentSource: rec.page.streamTextContent(), container: rec.textDiv, viewport: vp }).render();
    if (token !== rec.token) { rec.textDiv.replaceChildren(); return; }
    rec.rendered = true;
  } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn('Render error, page', rec.n, e); }
  finally { if (token === rec.token) rec.rendering = false; }
}
function buildThumbs() {
  const sb = $('#side'); sb.replaceChildren(); ioThumb?.disconnect();
  ioThumb = new IntersectionObserver((entries) => entries.forEach((en) => { if (!en.isIntersecting || en.target.dataset.done) return; en.target.dataset.done = 1; drawThumb(S.pages[+en.target.dataset.page - 1], en.target); }), { root: sb, rootMargin: '400px 0px' });
  S.pages.forEach((p) => {
    const w = 120, h = Math.round((p.h / p.w) * w);
    const t = el('div', { class: 'thumb', 'data-page': p.n }, el('div', { class: 'tc', style: `width:${w}px;height:${h}px` }), el('div', { class: 'tn' }, String(p.n)));
    p.thumb = t; S.api.decorateThumb(t, p.n); sb.append(t); ioThumb.observe(t);
  });
}
async function drawThumb(rec, node) {
  const vp = rec.page.getViewport({ scale: 120 / rec.w }), c = document.createElement('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = vp.width * dpr; c.height = vp.height * dpr; c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px'; c.className = 'tc';
  try { await rec.page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise; node.querySelector('.tc').replaceWith(c); } catch (e) { /* ignore */ }
}

function setZoom(z) {
  if (!S.pdf) return;
  const old = S.zoom; z = Math.min(4, Math.max(0.25, z));
  const top = wrapEl.scrollTop, mid = wrapEl.clientHeight / 2, ratio = z / old;
  S.zoom = z; S.fit = 'manual'; layoutPages(); wrapEl.scrollTop = (top + mid) * ratio - mid;
}
function fitWidth(initial) {
  if (!S.pages.length) return;
  let z = (wrapEl.clientWidth - 64) / (S.pages[0].w * BASE);
  if (initial) z = Math.min(z, 1.25);
  S.zoom = Math.min(4, Math.max(0.25, z)); S.fit = 'width'; layoutPages();
}
function fitPage() { if (!S.pages.length) return; const p = S.pages[S.cur - 1]; setZoom(Math.min((wrapEl.clientWidth - 64) / (p.w * BASE), (wrapEl.clientHeight - 40) / (p.h * BASE))); }
// Jump history: page jumps (page field, preview, search …) remember the old position; mouse buttons 4/5 go back/forward.
const navBack = [], navFwd = [];
function jumpBack() { const t = navBack.pop(); if (t == null) return false; navFwd.push(wrapEl.scrollTop); wrapEl.scrollTop = t; return true; }
function jumpFwd() { const t = navFwd.pop(); if (t == null) return false; navBack.push(wrapEl.scrollTop); wrapEl.scrollTop = t; return true; }
function goTo(n) {
  if (!S.pages.length) return; n = Math.min(S.pages.length, Math.max(1, n | 0));
  const target = S.pages[n - 1].el.offsetTop - 38;
  if (Math.abs(target - wrapEl.scrollTop) > 4) { navBack.push(wrapEl.scrollTop); if (navBack.length > 50) navBack.shift(); navFwd.length = 0; }
  wrapEl.scrollTop = target; setCur(n);
}
const mouseNav = (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault(); e.stopPropagation();
  if (e.type !== 'mouseup') return;
  const ok = e.button === 3 ? jumpBack() : jumpFwd();
  if (!ok) toast(e.button === 3 ? t('Nothing to jump back to.') : t('Nothing to jump forward to.'));
};
for (const ev of ['mousedown', 'mouseup', 'auxclick']) window.addEventListener(ev, mouseNav, true);
function setCur(n) {
  if (n === S.cur && $('#pageInput').value == n && document.querySelector('.thumb.cur')) return;
  S.cur = n; $('#pageInput').value = n;
  $$('.thumb.cur').forEach((t) => t.classList.remove('cur'));
  const t = S.pages[n - 1]?.thumb;
  if (t) { t.classList.add('cur'); const sb = $('#side'), r = t.getBoundingClientRect(), b = sb.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) sb.scrollTop += r.top - b.top - 40; }
}
let scrollRaf = 0;
wrapEl.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const lim = wrapEl.scrollTop + 90;
    for (const p of S.pages) if (p.el.offsetTop + p.el.offsetHeight > lim) { setCur(p.n); break; }
    hideSel();
  });
});
$('#pageInput').addEventListener('change', (e) => goTo(parseInt(e.target.value, 10) || 1));
$('#zoomIn').onclick = () => setZoom(S.zoom * 1.15);
$('#zoomOut').onclick = () => setZoom(S.zoom / 1.15);
$('#zoomLabel').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, [...[50, 75, 100, 125, 150, 200, 300].map((v) => ({ l: v + ' %', f: () => setZoom(v / 100) })), '-', { l: t('Fit width'), f: () => fitWidth(false) }, { l: t('Fit page'), f: fitPage }, '-', { l: t('Dark pages (for reading at night)'), ic: S.view.dark ? 'check' : 'moon', f: () => { S.view.dark = !S.view.dark; applyView(); saveView(); } }, { l: t('Customize toolbar …'), ic: 'sliders', f: customizeDialog }]); };
$('#btnSide').onclick = () => $('#sideCol').classList.toggle('hidden');
wrapEl.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.pdf && S.fit === 'width') fitWidth(false); }, 200); });

// ------------------------------------------------------------ Text
async function getPageText(n) {
  if (S.texts[n - 1] != null) return S.texts[n - 1];
  const tc = await S.pages[n - 1].page.getTextContent();
  const t = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  S.texts[n - 1] = t; return t;
}
async function textContent(n) { const k = S.docId; const tc = S.tc[n] || await S.pages[n - 1].page.getTextContent(); if (k === S.docId) S.tc[n] = tc; return tc; }
async function getAllTexts() { for (let n = 1; n <= S.pages.length; n++) await getPageText(n); return S.texts.slice(); }

// ------------------------------------------------------------ Annotations
const KINDS = ['hl', 'ink', 'notes', 'sigs', 'texts', 'imgs'];
const annOf = (n) => { const a = (S.ann[n] ||= {}); KINDS.forEach((k) => { a[k] ||= []; }); return a; };
const STYLE_CLASS = { ul: ' ul', st: ' st' };
function renderAnn(n) {
  const rec = S.pages[n - 1]; if (!rec) return;
  const a = S.ann[n] || {};
  rec.hlDiv.replaceChildren(...(a.hl || []).flatMap((h) => h.rects.map((r) => {
    const d = el('div', { class: 'hl' + (STYLE_CLASS[h.style] || '') + (h.note ? ' hasNote' : ''), 'data-ann': h.id, 'data-kind': 'hl', 'data-page': n });
    d.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%;--c:${h.color}` + (h.style && h.style !== 'hl' ? '' : `;background:${h.color}`); return d;
  })));
  const aspect = rec.w / rec.h;
  rec.ink.replaceChildren(...(a.ink || []).flatMap((s) => shapePolys(s, aspect).flatMap((poly) => {
    const pts = poly.map((p) => p.join(',')).join(' '), marker = s.shape === 'marker';
    const vis = svgEl('polyline', { class: 'inkvis' + (marker ? ' marker' : ''), points: pts, stroke: s.color, 'stroke-width': marker ? s.w * 4 : s.w, 'vector-effect': 'non-scaling-stroke' });
    const hit = svgEl('polyline', { class: 'inkhit', points: pts, 'vector-effect': 'non-scaling-stroke' });
    [vis, hit].forEach((x) => { x.dataset.ann = s.id; x.dataset.kind = 'ink'; x.dataset.page = n; }); return [vis, hit];
  })));
  rec.noteDiv.replaceChildren(...(a.sigs || []).map((sg) => makeSigEl(n, sg)), ...(a.imgs || []).map((im) => makeImgEl(n, im)), ...(a.texts || []).map((x) => makeTextEl(n, x)), ...(a.notes || []).map((nt) => {
    const m = el('div', { class: 'noteMark', title: nt.text, 'data-ann': nt.id, 'data-kind': 'notes', 'data-page': n, html: icon('note') });
    m.style.left = nt.x * 100 + '%'; m.style.top = nt.y * 100 + '%';
    // Click opens, dragging moves the comment
    m.addEventListener('pointerdown', (e) => {
      if (S.tool === 'erase' || e.button !== 0) return; e.preventDefault(); e.stopPropagation();
      const pr = rec.el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY; let moved = false, nx = nt.x, ny = nt.y;
      m.setPointerCapture(e.pointerId);
      const mv = (ev) => { const dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height; if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; nx = Math.min(0.99, Math.max(0, nt.x + dx)); ny = Math.min(0.99, Math.max(0, nt.y + dy)); m.style.left = nx * 100 + '%'; m.style.top = ny * 100 + '%'; };
      const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); if (moved) updateItem('notes', n, nt.id, { x: nx, y: ny }); else openNoteEditor(n, nt.x, nt.y, nt, m); };
      m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up);
    });
    return m;
  }));
  S.api.scheduleMarks?.();
}
// Changes to annotations, each with undo: add, remove, modify (patch), batch (several at once)
function addItem(kind, n, item, record = true) { annOf(n)[kind].push(item); renderAnn(n); if (record) pushUndo({ op: 'add', kind, n, item }); saveAnn(); }
function removeItem(kind, n, id, record = true) {
  const arr = annOf(n)[kind], i = arr.findIndex((x) => x.id === id); if (i < 0) return null;
  const [item] = arr.splice(i, 1); renderAnn(n); const op = { op: 'remove', kind, n, item, index: i }; if (record) pushUndo(op); saveAnn(); return op;
}
function updateItem(kind, n, id, patch, record = true) {
  const it = annOf(n)[kind].find((x) => x.id === id); if (!it) return;
  const before = {}; for (const k of Object.keys(patch)) before[k] = it[k];
  Object.assign(it, patch); for (const k of Object.keys(patch)) if (patch[k] === undefined) delete it[k];
  renderAnn(n); if (record) pushUndo({ op: 'mod', kind, n, id, before, after: patch }); saveAnn();
}
function clearPage(n) {
  const a = S.ann[n]; if (!a) return 0;
  const ops = [];
  for (const k of KINDS) for (const it of (a[k] || []).slice()) { const op = removeItem(k, n, it.id, false); if (op) ops.push(op); }
  if (ops.length) pushUndo({ op: 'batch', ops });
  return ops.length;
}
function pushUndo(op) { S.undo.push(op); S.redo = []; updateUndo(); }
function updateUndo() { $('#tUndo').disabled = !S.undo.length; $('#tRedo').disabled = !S.redo.length; }
function revert(op) { // undo one annotation operation
  if (op.op === 'add') removeItem(op.kind, op.n, op.item.id, false);
  else if (op.op === 'remove') { annOf(op.n)[op.kind].splice(op.index, 0, op.item); renderAnn(op.n); saveAnn(); }
  else if (op.op === 'mod') updateItem(op.kind, op.n, op.id, op.before, false);
  else if (op.op === 'batch') op.ops.slice().reverse().forEach(revert);
}
function replay(op) { // redo
  if (op.op === 'add') { annOf(op.n)[op.kind].push(op.item); renderAnn(op.n); saveAnn(); }
  else if (op.op === 'remove') removeItem(op.kind, op.n, op.item.id, false);
  else if (op.op === 'mod') updateItem(op.kind, op.n, op.id, op.after, false);
  else if (op.op === 'batch') op.ops.forEach(replay);
}
function undo() { const op = S.undo.pop(); if (!op) return; if (op.op === 'doc') { swapDoc(op).then((rev) => { S.redo.push(rev); updateUndo(); }); return; } revert(op); S.redo.push(op); updateUndo(); }
function redo() { const op = S.redo.pop(); if (!op) return; if (op.op === 'doc') { swapDoc(op).then((rev) => { S.undo.push(rev); updateUndo(); }); return; } replay(op); S.undo.push(op); updateUndo(); }
$('#tUndo').onclick = undo; $('#tRedo').onclick = redo;

async function swapDoc(op) {
  const cur = { op: 'doc', bytes: S.bytes, ann: S.ann };
  S.bytes = op.bytes; S.ann = op.ann; S.dirty = true; await reload(); S.api.updateDirty && S.api.updateDirty();
  return cur;
}
let saveT = null;
function flushAnn() { clearTimeout(saveT); saveT = null; post({ type: 'saveAnn', ann: S.ann }); }
function saveAnn() { clearTimeout(saveT); saveT = setTimeout(flushAnn, 500); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveT) flushAnn(); });
window.addEventListener('pagehide', () => { if (saveT) flushAnn(); });

function pageOfNode(node) { const p = node?.parentElement?.closest?.('.page') || node?.closest?.('.page'); return p ? +p.dataset.page : S.cur; }
function selectionToHighlight(color, style = 'hl') {
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const text = sel.toString().replace(/\s+/g, ' ').trim(); if (!text) return false;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  const byPage = new Map(), seen = new Set(), boxes = S.pages.filter((p) => p.rendered).map((p) => ({ p, b: p.el.getBoundingClientRect() }));
  for (const r of rects) {
    const key = [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join('|'); if (seen.has(key)) continue; seen.add(key);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = boxes.find(({ b }) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom); if (!hit) continue;
    const { p, b } = hit; if (r.height / b.height > 0.15) continue;
    const x = Math.max(0, (r.left - b.left) / b.width), y = (r.top - b.top) / b.height, w = Math.min(1 - x, r.width / b.width), h = r.height / b.height;
    (byPage.get(p.n) || byPage.set(p.n, []).get(p.n)).push([x, y, w, h]);
  }
  if (!byPage.size) return false;
  let first = true;
  for (const [n, rs] of byPage) { addItem('hl', n, { id: uid(), color, rects: rs, text: first ? text : '…', ...(style !== 'hl' ? { style } : {}), at: Date.now() }); first = false; }
  sel.removeAllRanges(); return true;
}
function hideSel() { $('#selPop').hidden = true; }
function showSelPop(sel) {
  const r = sel.getRangeAt(0).getBoundingClientRect(), pop = $('#selPop'), text = sel.toString(), page = pageOfNode(sel.anchorNode);
  pop.replaceChildren(
    ...HL_COLORS.map((c) => el('button', { class: 'swatch', style: `background:${c}`, title: t('Highlight'), onmousedown: (e) => e.preventDefault(), onclick: () => { selectionToHighlight(c); hideSel(); } })),
    el('button', { class: 't ico', title: t('Underline'), html: icon('underline'), onmousedown: (e) => e.preventDefault(), onclick: () => { selectionToHighlight(S.ulColor, 'ul'); hideSel(); } }),
    el('button', { class: 't ico', title: t('Strike through'), html: icon('strike'), onmousedown: (e) => e.preventDefault(), onclick: () => { selectionToHighlight(S.ulColor, 'st'); hideSel(); } }),
    el('button', { class: 't', onmousedown: (e) => e.preventDefault(), onclick: () => { hideSel(); askClaude('explain', { selection: text, page }); } }, t('{name}: Explain', { name: S.ai.name })),
    el('button', { class: 't', onmousedown: (e) => e.preventDefault(), onclick: async () => { try { await navigator.clipboard.writeText(text); toast(t('Copied'), 1200); } catch (e) {} hideSel(); } }, t('Copy')));
  pop.hidden = false;
  const pw = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + 'px';
}
wrapEl.addEventListener('mouseup', () => setTimeout(() => {
  if (['draw', 'erase', 'note', 'text', 'edit', 'image', 'redact', 'sign'].includes(S.tool)) return;
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.toString().trim() || !viewerEl.contains(sel.anchorNode)) return;
  if (S.tool === 'hl') { selectionToHighlight(S.hlStyle === 'hl' ? S.hlColor : S.ulColor, S.hlStyle); return; }
  showSelPop(sel);
}, 10));
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#selPop')) hideSel(); if (!e.target.closest('#notePop') && !e.target.closest('.noteMark')) closeNote(); if (!e.target.closest('#menuPop') && !e.target.closest('#zoomLabel') && !e.target.closest('#tClaude')) hideMenu(); });

// Click on an existing highlight (no text selected): change color/kind, note, copy, explain, delete
function hlAt(e) {
  const pe = e.target.closest?.('.page'); if (!pe) return null;
  const n = +pe.dataset.page, b = pe.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
  const h = (S.ann[n]?.hl || []).find((q) => q.rects.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] - 0.003 && y <= r[1] + r[3] + 0.003));
  return h ? { n, h } : null;
}
function hlMenu(cx, cy, n, h) {
  const style = h.style || 'hl', cols = style === 'hl' ? HL_COLORS : LINE_COLORS;
  showMenu(cx, cy, [
    { swatches: cols, cur: h.color, label: t('Color'), f: (c) => updateItem('hl', n, h.id, { color: c }) },
    '-',
    { l: t('Highlight'), ic: style === 'hl' ? 'check' : 'marker', f: () => updateItem('hl', n, h.id, { style: undefined, color: HL_COLORS.includes(h.color) ? h.color : S.hlColor }) },
    { l: t('Underline'), ic: style === 'ul' ? 'check' : 'underline', f: () => updateItem('hl', n, h.id, { style: 'ul', color: LINE_COLORS.includes(h.color) ? h.color : S.ulColor }) },
    { l: t('Strike through'), ic: style === 'st' ? 'check' : 'strike', f: () => updateItem('hl', n, h.id, { style: 'st', color: LINE_COLORS.includes(h.color) ? h.color : S.ulColor }) },
    '-',
    { l: h.note ? t('Edit note …') : t('Add note …'), ic: 'comment', f: () => hlNote(n, h) },
    ...(h.text && h.text !== '…' ? [{ l: t('Copy text'), ic: 'copy', f: async () => { try { await navigator.clipboard.writeText(h.text); toast(t('Copied'), 1200); } catch (e) { /* ignore */ } } },
      { l: t('{name}: Explain', { name: S.ai.name }), ic: 'spark', f: () => askClaude('explain', { selection: h.text, page: n }) }] : []),
    { l: t('Show in list'), ic: 'list', f: () => showPane('marks') },
    '-',
    { l: t('Delete'), ic: 'trash', k: 'Del', f: () => removeItem('hl', n, h.id) }
  ]);
}
function hlNote(n, h) {
  const ta = el('textarea', { rows: 4, placeholder: t('Your note on this passage …') }); ta.value = h.note || '';
  modal({ title: t('Note on the highlight'), body: el('div', { class: 'stack' }, h.text && h.text !== '…' ? el('blockquote', { class: 'quote' }, h.text) : null, ta), actions: [{ label: t('Cancel') }, { label: t('Save'), primary: true, onClick: () => updateItem('hl', n, h.id, { note: ta.value.trim() || undefined }) }] });
  setTimeout(() => ta.focus(), 30);
}
viewerEl.addEventListener('click', (e) => {
  if (!['select', 'hl'].includes(S.tool) || e.button !== 0) return;
  const sel = getSelection(); if (sel && !sel.isCollapsed && sel.toString().trim()) return;
  const f = hlAt(e); if (f) hlMenu(e.clientX + 4, e.clientY + 8, f.n, f.h);
});
viewerEl.addEventListener('contextmenu', (e) => {
  const f = ['select', 'hl', 'note'].includes(S.tool) && hlAt(e); if (!f) return;
  e.preventDefault(); hlMenu(e.clientX, e.clientY, f.n, f.h);
});

// Draw / erase / comment
let drawing = null;
viewerEl.addEventListener('pointerdown', (e) => {
  if (S.tool === 'erase' && e.button === 0) { eraseAt(e); return; }
  if (S.tool !== 'draw' || e.button !== 0) return;
  const svg = e.target.closest?.('.inkLayer'); if (!svg) return;
  const b = svg.getBoundingClientRect(), pt = (ev) => [Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))];
  const n = +svg.dataset.page, rec = S.pages[n - 1], marker = S.shape === 'marker';
  const live = svgEl('polyline', { class: 'inkvis' + (marker ? ' marker' : ''), stroke: S.penColor, 'stroke-width': marker ? S.penW * 4 : S.penW, 'vector-effect': 'non-scaling-stroke' }); svg.append(live);
  drawing = { n, pts: [pt(e)], live, pt, id: e.pointerId, shape: S.shape, aspect: rec.w / rec.h, shift: e.shiftKey }; svg.setPointerCapture(e.pointerId); e.preventDefault();
});
viewerEl.addEventListener('pointermove', (e) => {
  if (S.tool === 'erase') { moveEraser(e); if (e.buttons & 1) eraseAt(e); return; }
  if (!drawing || e.pointerId !== drawing.id) return;
  const p = drawing.pt(e), d = drawing;
  if (d.shape === 'free' || d.shape === 'marker') {
    if (e.shiftKey) { d.pts = [d.pts[0], p]; } // Shift: straight line
    else { const last = d.pts[d.pts.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0006) return; d.pts.push(p); }
  } else d.pts = [d.pts[0], p];
  d.live.setAttribute('points', shapePolys({ shape: d.shape, pts: d.pts, w: S.penW }, d.aspect).map((poly) => poly.map((q) => q.join(',')).join(' ')).join(' '));
});
const endDraw = (e) => {
  if (!drawing || e.pointerId !== drawing.id) return;
  const d = drawing; drawing = null; d.live.remove();
  if (d.pts.length === 1) { if (d.shape !== 'free' && d.shape !== 'marker') return; d.pts.push([d.pts[0][0] + 0.0004, d.pts[0][1]]); }
  addItem('ink', d.n, { id: uid(), color: S.penColor, w: S.penW, ...(d.shape !== 'free' ? { shape: d.shape } : {}), pts: d.pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) });
};
viewerEl.addEventListener('pointerup', endDraw); viewerEl.addEventListener('pointercancel', endDraw);
// Eraser: removes every annotation under the circle (size adjustable)
const eraserRing = el('div', { class: 'eraserRing', hidden: true }); document.body.append(eraserRing);
function moveEraser(e) { eraserRing.hidden = false; const r = S.eraseR; eraserRing.style.cssText = `left:${e.clientX - r}px;top:${e.clientY - r}px;width:${2 * r}px;height:${2 * r}px`; }
viewerEl.addEventListener('pointerleave', () => { eraserRing.hidden = true; });
function eraseAt(e) {
  const r = S.eraseR, seen = new Set(), pts = [[0, 0]];
  for (let k = 0; k < 8; k++) pts.push([Math.cos(k * Math.PI / 4) * r * 0.85, Math.sin(k * Math.PI / 4) * r * 0.85]);
  for (const [dx, dy] of pts) for (const x of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
    const tg = x.closest?.('[data-ann]'); if (!tg || seen.has(tg.dataset.ann)) continue;
    seen.add(tg.dataset.ann); removeItem(tg.dataset.kind, +tg.dataset.page, tg.dataset.ann);
  }
}

viewerEl.addEventListener('click', (e) => {
  if (S.tool !== 'note' || e.target.closest('.noteMark')) return;
  const pe = e.target.closest('.page'); if (!pe) return; const b = pe.getBoundingClientRect();
  openNoteEditor(+pe.dataset.page, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height, null, null, e.clientX, e.clientY);
});
function closeNote() { $('#notePop').hidden = true; }
function openNoteEditor(n, x, y, item, anchor, cx, cy) {
  const pop = $('#notePop'), ta = el('textarea', { placeholder: t('Comment …') }); ta.value = item?.text || '';
  const save = () => { const t = ta.value.trim(); if (item) { if (t) { item.text = t; renderAnn(n); saveAnn(); } else removeItem('notes', n, item.id); } else if (t) addItem('notes', n, { id: uid(), x, y, text: t }); closeNote(); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') closeNote(); });
  pop.replaceChildren(ta, el('div', { class: 'row' }, item ? el('button', { class: 'pillBtn', onclick: () => { removeItem('notes', n, item.id); closeNote(); } }, t('Delete')) : null, el('button', { class: 'pillBtn primary', onclick: save }, t('Save'))));
  pop.hidden = false;
  const r = anchor ? anchor.getBoundingClientRect() : { left: cx, bottom: cy };
  pop.style.left = Math.min(innerWidth - 270, Math.max(8, r.left)) + 'px'; pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, (r.bottom || cy) + 8) + 'px'; ta.focus();
}

// Tools
const seg = (items, cur, set) => el('span', { class: 'mini seg' }, ...items.map(([v, ic, tip]) => el('button', { class: 'tb icon' + (v === cur ? ' active' : ''), title: tip, 'aria-pressed': String(v === cur), html: icon(ic), onclick: () => { set(v); renderToolOpts(); } })));
const swatches = (cols, cur, set) => cols.map((c) => el('button', { class: 'swatch' + (c === cur ? ' on' : ''), style: `background:${c}`, title: t('Color'), onclick: () => { set(c); renderToolOpts(); } }));
function renderToolOpts() {
  const tl = S.tool, o = $('#toolOpts'); o.replaceChildren();
  if (tl === 'hl') {
    o.append(seg([['hl', 'marker', t('Highlight')], ['ul', 'underline', t('Underline')], ['st', 'strike', t('Strike through')]], S.hlStyle, (v) => { S.hlStyle = v; }),
      ...(S.hlStyle === 'hl' ? swatches(HL_COLORS, S.hlColor, (c) => { S.hlColor = c; }) : swatches(LINE_COLORS, S.ulColor, (c) => { S.ulColor = c; })),
      el('span', {}, t('Select text – it is marked right away. Click a highlight to change or annotate it.')));
  } else if (tl === 'draw') {
    o.append(seg([['free', 'pen', t('Free hand (Shift = straight)')], ['marker', 'marker', t('Highlighter pen (for scans and images)')], ['line', 'shapeLine', t('Line')], ['arrow', 'shapeArrow', t('Arrow')], ['rect', 'shapeRect', t('Rectangle')], ['ellipse', 'shapeEllipse', t('Ellipse')]], S.shape, (v) => { S.shape = v; }),
      ...swatches(S.shape === 'marker' ? HL_COLORS : PEN_COLORS, S.penColor, (c) => { S.penColor = c; }), el('span', {}, t('Width')));
    const r = el('input', { type: 'range', min: 1, max: 12, value: S.penW, 'aria-label': t('Width') }); r.oninput = () => { S.penW = +r.value; }; o.append(r);
  } else if (tl === 'erase') {
    const r = el('input', { type: 'range', min: 4, max: 40, value: S.eraseR, 'aria-label': t('Eraser size') }); r.oninput = () => { S.eraseR = +r.value; };
    o.append(el('span', { class: 'ico', html: icon('eraser') }), el('span', {}, t('Click or drag over what should disappear (highlights, drawings, comments, text boxes, images, signatures).')), el('span', {}, t('Size')), r,
      el('button', { class: 'pillBtn', onclick: () => { const k = clearPage(S.cur); toast(k ? t('{n} annotation(s) removed from page {p} – undo with Ctrl+Z.', { n: k, p: S.cur }) : t('Page {p} has no annotations.', { p: S.cur })); } }, t('Clear this page')));
  } else if (tl === 'note') o.append(el('span', {}, t('Click on the page to add a comment. Drag a comment to move it.')));
  else if (!editOpts(tl, o)) S.api.toolOptsExt?.(tl, o);
  o.hidden = !o.childElementCount;
}
function setTool(t, force) {
  if (S.tool === t) t = 'select';
  if (S.tool === 'edit' && t !== 'edit' && !force && !leaveEdit(t)) return;
  if (t === 'draw' && S.shape === 'marker' && !HL_COLORS.includes(S.penColor)) S.penColor = HL_COLORS[0];
  if (t === 'draw' && S.shape !== 'marker' && !PEN_COLORS.includes(S.penColor)) S.penColor = PEN_COLORS[0];
  S.tool = t;
  document.body.className = document.body.className.replace(/\btool-\w+/g, '').trim() + ' tool-' + t;
  $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t)); renderToolOpts();
  if (t !== 'erase') eraserRing.hidden = true;
}
$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// Menu
function hideMenu() { $('#menuPop').hidden = true; }
function showMenu(x, y, items) {
  const m = $('#menuPop');
  const row = (it) => {
    if (it === '-') return el('div', { class: 'msep' });
    if (it.swatches) return el('div', { class: 'mswatch' }, it.label ? el('span', { class: 'muted' }, it.label) : null, ...it.swatches.map((c) => el('button', { class: 'swatch' + (c === it.cur ? ' on' : ''), style: `background:${c}`, title: t('Color'), onclick: () => { hideMenu(); it.f(c); } })));
    const b = el('button', { class: 'mi', disabled: !!it.d, onclick: () => { hideMenu(); it.f && it.f(); } }, it.dot ? el('span', { class: 'mdot', style: `background:${it.dot}` }) : null, it.ic ? el('span', { class: 'mic', html: icon(it.ic) }) : (it.ic === null && !it.dot ? el('span', { class: 'mic' }) : null), it.img ? el('img', { class: 'mimg', src: it.img, alt: '' }) : null, it.l ? el('span', {}, it.l) : null, it.k ? el('small', {}, it.k) : '');
    if (!it.pin) return b;
    const on = isPinned(it.pin), tip = on ? t('Remove from toolbar') : t('Pin to toolbar');
    const p = el('button', { class: 'pinBtn' + (on ? ' on' : ''), type: 'button', title: tip, 'aria-label': tip, 'aria-pressed': String(on), html: icon('pin'), onclick: (e) => { e.stopPropagation(); toggleQuick(it.pin); showMenu(x, y, items); } });
    return el('div', { class: 'miRow' }, b, p);
  };
  m.replaceChildren(...items.map(row));
  m.hidden = false; m.scrollTop = 0; m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}

// ------------------------------------------------------------ AI display (name and icon of the chosen AI)
S.ai = { id: 'claude-code', name: 'AI', icon: null };
function applyAi(ai) {
  if (!ai) return;
  S.ai = ai;
  const b = $('#tClaude'); if (!b) return;
  b.title = t('Give {name} a task', { name: ai.name });
  b.querySelector('.lbl').textContent = ai.name;
  const old = b.querySelector('.ic, .aiIcon, .aiBadge');
  let n;
  if (ai.icon) n = el('img', { class: 'aiIcon', src: ai.icon, alt: '' });
  else if (ai.name && ai.name !== 'AI' && ai.name !== 'KI') { n = el('span', { class: 'aiBadge' }, ai.name[0].toUpperCase()); let h = 0; for (const c of ai.name) h = (h * 31 + c.charCodeAt(0)) % 360; n.style.background = `hsl(${h} 55% 42%)`; }
  else { n = el('span', { class: 'ic' }); n.innerHTML = icon('spark'); }
  old.replaceWith(n);
}
S.api.applyAi = applyAi;
window.addEventListener('message', (e) => { if (e.data?.type === 'ai') applyAi(e.data.ai); });

// ------------------------------------------------------------ Claude
async function askClaude(kind, extra = {}) {
  if (!S.pdf) return;
  flushAnn();
  if (kind !== 'explain') { toast(t('Preparing text for {name} …', { name: S.ai.name }), 4000); }
  await textsReady; await sleep(350);
  post({ type: 'claude', kind, page: extra.page ?? S.cur, selection: extra.selection, count: extra.count });
}
function countDialog(kind, label) {
  const sel = el('select', {}, ...[5, 8, 12, 20].map((v) => el('option', { value: v, selected: v === 8 }, v)));
  modal({ title: label, body: el('label', { class: 'muted' }, t('Count') + ' ', sel), actions: [{ label: t('Cancel') }, { label: t('Send to {name}', { name: S.ai.name }), primary: true, onClick: () => askClaude(kind, { count: +sel.value }) }] });
}
$('#tClaude').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { l: t('Summarize this page'), f: () => askClaude('summary-page') },
    { l: t('Summarize whole PDF'), f: () => askClaude('summary-doc') },
    { l: t('Create study sheet'), f: () => askClaude('learn') },
    { l: t('Create quiz …'), f: () => countDialog('quiz', t('Create quiz')) },
    { l: t('Flashcards with {name} …', { name: S.ai.name }), f: () => countDialog('cards', t('Create flashcards')) },
    '-',
    { l: t('Ask a question about the PDF'), f: () => askClaude('ask') },
    '-',
    { l: t('Switch AI … (now: {name})', { name: S.ai.name }), f: () => post({ type: 'chooseAi' }) },
    { l: t('Set up PDF tools for the AI …'), f: () => post({ type: 'setupMcp' }) }
  ]);
};

// ------------------------------------------------------------ Flashcards from highlights
const esre = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function highlights() { const out = []; Object.keys(S.ann).map(Number).sort((a, b) => a - b).forEach((n) => S.ann[n].hl.filter((h) => h.text && h.text !== '…').forEach((h) => out.push({ page: n, text: h.text }))); return out; }
function clozeCards(hl, texts) {
  return hl.map((h) => {
    const tx = h.text.replace(/\s+/g, ' ').trim(), pt = (texts[h.page - 1] || '').replace(/\s+/g, ' ');
    if (tx.length > 140) return { front: t('Page {p}: How does the highlighted passage continue that begins with "{s} …"?', { p: h.page, s: tx.split(' ').slice(0, 6).join(' ') }), back: tx, page: h.page };
    const idx = pt.toLowerCase().indexOf(tx.toLowerCase());
    if (idx < 0) return { front: t('Page {p}: Complete the highlighted passage.', { p: h.page }), back: tx, page: h.page };
    let s = pt.lastIndexOf('. ', idx); s = s < 0 ? 0 : s + 2; let e = pt.indexOf('. ', idx + tx.length); e = e < 0 ? pt.length : e + 1;
    let sentence = pt.slice(s, e); if (sentence.length > 380) sentence = pt.slice(Math.max(0, idx - 130), idx + tx.length + 130);
    return { front: sentence.replace(new RegExp(esre(tx), 'i'), '[ … ]'), back: tx, page: h.page };
  });
}
async function cards() {
  const hl = highlights();
  if (!hl.length) { toast(t('Highlight passages in the text first. They become the flashcards.'), 4500); return; }
  runCards(clozeCards(hl, await getAllTexts()));
}
function runCards(deck) {
  deck = deck.slice(); let i = 0, known = 0; const total = deck.length, body = el('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const m = modal({ title: t('Flashcards'), body, wide: true, actions: [] });
  function show() {
    body.replaceChildren();
    if (i >= deck.length) { body.append(el('p', { class: 'qq' }, t('Done – {known} of {total} cards known.', { known, total })), el('div', { class: 'row' }, el('button', { class: 'pillBtn primary', onclick: () => m.close() }, t('Close')))); return; }
    const c = deck[i]; let flipped = false;
    const card = el('div', { class: 'card', onclick: flip }, el('div', {}, el('small', {}, t('Front') + (c.page ? ' · ' + t('p. {n}', { n: c.page }) : '')), c.front));
    function flip() { flipped = !flipped; card.replaceChildren(el('div', {}, el('small', {}, flipped ? t('Back') : t('Front')), flipped ? c.back : c.front)); btns.hidden = !flipped; }
    const btns = el('div', { class: 'row', hidden: true }, el('button', { class: 'pillBtn', onclick: () => { deck.push(c); i++; show(); } }, t('Again')), el('button', { class: 'pillBtn primary', onclick: () => { known++; i++; show(); } }, t('Known')));
    body.append(el('div', { class: 'progress' }, el('i', { style: `width:${(Math.min(i, total) / Math.max(total, deck.length)) * 100}%` })), el('p', { class: 'muted' }, t('Card {i} of {n} – click to flip', { i: i + 1, n: deck.length })), card, btns);
  }
  show();
}
$('#tCards').onclick = cards;

// ------------------------------------------------------------ View (dark pages) and file changes from outside
function applyView() { document.body.classList.toggle('darkPages', !!S.view.dark); }
function saveView() { post({ type: 'saveView', view: S.view }); }
window.addEventListener('message', async (e) => {
  if (e.data?.type !== 'fileChanged' || !S.pdf) return;
  const load = async () => { const r = await request({ type: 'reloadFile' }); if (!r.b64) return; const raw = b64ToBytes(r.b64); S.bytes = S.converted ? await convertFile(raw.buffer) : raw; S.dirty = !!S.converted; showMsg(''); S.api.updateDirty?.(); S.texts = []; await reload(); const tx = await getAllTexts(); post({ type: 'saveText', texts: tx }); toast(t('The file was changed outside and has been reloaded.'), 4000); };
  if (!S.dirty && !S.edits?.length) { load(); return; }
  modal({ title: t('File changed outside'), body: el('p', {}, t('Another program (or the AI) changed this PDF. Reload it? Your unsaved changes in the viewer would be lost.')), actions: [{ label: t('Keep my version') }, { label: t('Reload'), primary: true, onClick: () => { load(); } }] });
});

// Keyboard
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable, mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); showPane('search', true); return; }
  if (!typing && mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (!typing && mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (!typing && !mod && !e.altKey) {
    const k = e.key.toLowerCase();
    const keys = { h: 'hl', d: 'draw', e: 'erase', c: 'note', t: 'text', r: 'edit', i: 'image' };
    if (keys[k]) setTool(keys[k]);
    else if (e.key === 'Escape') { S.tool !== 'select' && setTool(S.tool); hideMenu(); closeNote(); hideSel(); }
  }
});


// ------------------------------------------------------------ Report a problem
async function reportDialog(kind) {
  let pdf = null;
  if (S.pdf) {
    pdf = { Pages: S.pdf.numPages, 'Size (KB)': Math.round((S.bytes?.length || 0) / 1024) };
    try { const i = (await S.pdf.getMetadata()).info || {}; if (i.Producer) pdf['Producer'] = String(i.Producer).slice(0, 80); if (i.PDFFormatVersion) pdf['PDF version'] = i.PDFFormatVersion; } catch (e) { /* none */ }
  }
  post({ type: 'report', kind, pdf });
}
window.addEventListener('error', (e) => post({ type: 'jsError', message: String(e.message || '').slice(0, 300) }));
window.addEventListener('unhandledrejection', (e) => post({ type: 'jsError', message: String(e.reason?.message || e.reason || '').slice(0, 300) }));

// ------------------------------------------------------------ Tools: registry, menu, quick bar
const toolDefs = () => [
  { id: 'merge', ic: 'merge', l: t('Merge PDFs …'), f: mergeDialog },
  { id: 'split', ic: 'split', l: t('Split PDF …'), f: splitDialog },
  { id: 'insert', ic: 'insertPage', l: t('Insert pages from PDF …'), f: () => insertFrom(S.cur) },
  { id: 'crop', ic: 'crop', l: t('Crop pages …'), f: cropDialog },
  { id: 'number', ic: 'number', l: t('Insert page numbers …'), f: numberDialog },
  { id: 'ocr', ic: 'ocr', l: t('Text recognition (OCR) …'), f: () => ocrDialog().catch((e) => toast('Error: ' + (e.message || e), 6000)) },
  { id: 'compress', ic: 'compress', l: t('Compress …'), f: compressDialog },
  { id: 'redact', ic: 'redact', l: t('Redact'), tool: 'redact', f: () => setTool('redact') },
  { id: 'sign', ic: 'sign', l: t('Place signature'), tool: 'sign', f: () => setTool('sign') }
];
const toolItem = (d) => ({ l: d.l, ic: d.ic, pin: d.id, f: d.f });

// ------------------------------------------------------------ Tools menu, saving
$('#tTools').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const d = Object.fromEntries(toolDefs().map((x) => [x.id, toolItem(x)]));
  showMenu(r.left, r.bottom + 4, [
    d.merge, d.split, d.insert, d.crop, d.number, d.ocr, d.compress,
    '-',
    d.redact, d.sign,
    '-',
    { l: t('Report a problem …'), f: () => reportDialog('bug') },
    { l: t('Send feedback …'), f: () => reportDialog('praise') },
    { l: t('Licenses …'), f: () => post({ type: 'licenses' }) }
  ]);
};
// Jump to a place (page, optionally a box 0..1) and let it light up briefly
function reveal(n, r, keepFlash) {
  const p = S.pages[n - 1]; if (!p) return;
  goTo(n);
  if (r) {
    wrapEl.scrollTop = Math.max(0, p.el.offsetTop + r[1] * p.el.offsetHeight - wrapEl.clientHeight / 3);
    const left = p.el.offsetLeft + r[0] * p.el.offsetWidth; if (left < wrapEl.scrollLeft || left > wrapEl.scrollLeft + wrapEl.clientWidth - 40) wrapEl.scrollLeft = Math.max(0, left - 40);
    if (!keepFlash || r[3] > 0) { const f = el('div', { class: 'flash' }); f.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${Math.max(r[2], 0.02) * 100}%;height:${Math.max(r[3], 0.012) * 100}%`; p.el.append(f); setTimeout(() => f.remove(), 1600); }
  }
}
Object.assign(S.api, { reload, request, post, showMenu, goTo, flushAnn, saveAnn, getAllTexts, updateUndo, renderToolOpts, addItem, removeItem, updateItem, setTool, renderAnn, textContent, reveal, askClaude, countDialog, saveView, toolDefs, toggleQuick });
initPages(); initTools(); initPanel(); initEdit(); initShare();
S.tool = 'none'; setTool('select');
window.__pdfWorkbench = { S, getAllTexts };
start();

// Toolbar: mouse wheel scrolls sideways when the window is too narrow
{
  const bar = $('#bar');
  if (bar) bar.addEventListener('wheel', (e) => { if (bar.scrollWidth > bar.clientWidth && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) { bar.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
}
