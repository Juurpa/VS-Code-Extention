import * as pdfjsLib from './lib/pdf.min.mjs';
import { PDFDocument, rgb, StandardFonts, BlendMode, LineCapStyle, degrees } from './lib/pdf-lib.esm.min.js';
import { S, $, $$, el, icon, fillIcons, toast, modal, uid } from './util.js';
import { toPdf } from './pdfops.js';
import { initPages, saveFile, saveAs, mergeDialog, splitDialog, compressDialog, cropDialog, numberDialog, insertFrom } from './pages.js';
import { initTools, makeSigEl, drawRed } from './tools.js';
import { ocrDialog } from './ocr.js';

const vscode = acquireVsCodeApi();
const cfg = JSON.parse($('#cfg').dataset.cfg);
const BASE = 96 / 72;
const HL_COLORS = ['#fff176', '#a5f3a0', '#8fd3ff', '#ffadd2'];
const PEN_COLORS = ['#e53935', '#1e88e5', '#212121', '#43a047'];
const wrapEl = $('#wrap'), viewerEl = $('#viewer');
const post = (m) => vscode.postMessage(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fillIcons();
document.title = cfg.name;

// ------------------------------------------------------------ Laden
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
  try { S.pdf?.destroy(); } catch (e) { /* egal */ }
  io?.disconnect(); ioThumb?.disconnect(); viewerEl.replaceChildren(); S.pages = []; S.texts = [];
  S.pdf = await pdfjsLib.getDocument({
    data: S.bytes.slice(), worker,
    cMapUrl: cfg.mediaUri + '/lib/cmaps/', cMapPacked: true,
    standardFontDataUrl: cfg.mediaUri + '/lib/standard_fonts/'
  }).promise;
  $('#pageCount').textContent = S.pdf.numPages;
  await buildPages();
}
// Nach Änderungen am Dokument (Seiten gedreht, gelöscht, …) neu aufbauen, Ansicht beibehalten
async function reload() {
  const z = S.zoom, top = wrapEl.scrollTop, cur = S.cur;
  S.red = {}; S.undo = S.undo; hideSel();
  await loadDoc();
  S.zoom = z; layoutPages(); S.pages.forEach((p) => renderAnn(p.n));
  wrapEl.scrollTop = top; S.cur = 0; setCur(Math.min(cur, S.pages.length));
  flushAnn(); markSelSafe();
}
const markSelSafe = () => S.api.markSel && S.api.markSel();

async function start() {
  showMsg('PDF wird geladen …');
  try {
    const [buf, init] = await Promise.all([fetch(cfg.pdfUri).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }), initP]);
    S.bytes = new Uint8Array(buf).slice();
    S.ann = init.ann || {}; S.sig = init.sig || null; applyAi(init.ai);
    await loadDoc();
    showMsg('');
    fitWidth(true);
    S.pages.forEach((p) => renderAnn(p.n));
    S.pdf.getPage(1).then((p) => p.getTextContent()).then((t) => { if (!t.items.some((i) => i.str && i.str.trim())) toast('Diese PDF sieht nach einem Scan aus (kein Text auf Seite 1). Unter Werkzeuge → „Texterkennung (OCR)“ wird sie durchsuchbar.', 9000); }).catch(() => {});
    if (!init.hasText) textsReady = (async () => { const t = await getAllTexts(); post({ type: 'saveText', texts: t }); })();
  } catch (e) {
    console.error(e);
    showMsg('PDF konnte nicht geöffnet werden: ' + (e.message || e));
  }
}

// ------------------------------------------------------------ Seiten & Rendern
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
  } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn('Render-Fehler Seite', rec.n, e); }
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
  try { await rec.page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise; node.querySelector('.tc').replaceWith(c); } catch (e) { /* ignorieren */ }
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
// Sprungverlauf: Seitensprünge (Seitenfeld, Vorschau, Suche …) merken die alte Stelle; Maustasten 4/5 gehen zurück/vor.
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
  if (!ok) toast(e.button === 3 ? 'Nichts zum Zurückspringen.' : 'Nichts zum Vorspringen.');
};
for (const ev of ['mousedown', 'mouseup', 'auxclick']) window.addEventListener(ev, mouseNav, true);
function setCur(n) {
  if (n === S.cur && $('#pageInput').value == n) return;
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
$('#zoomLabel').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, [...[50, 75, 100, 125, 150, 200, 300].map((v) => ({ l: v + ' %', f: () => setZoom(v / 100) })), '-', { l: 'An Breite anpassen', f: () => fitWidth(false) }, { l: 'Ganze Seite', f: fitPage }]); };
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
async function getAllTexts() { for (let n = 1; n <= S.pages.length; n++) await getPageText(n); return S.texts.slice(); }

// ------------------------------------------------------------ Annotationen
const annOf = (n) => { const a = (S.ann[n] ||= { hl: [], ink: [], notes: [], sigs: [] }); a.sigs ||= []; return a; };
function renderAnn(n) {
  const rec = S.pages[n - 1]; if (!rec) return;
  const a = S.ann[n] || { hl: [], ink: [], notes: [] };
  rec.hlDiv.replaceChildren(...a.hl.flatMap((h) => h.rects.map((r) => {
    const d = el('div', { class: 'hl', 'data-ann': h.id, 'data-kind': 'hl', 'data-page': n });
    d.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%;background:${h.color}`; return d;
  })));
  rec.ink.replaceChildren(...a.ink.flatMap((s) => {
    const pts = s.pts.map((p) => p.join(',')).join(' ');
    const vis = svgEl('polyline', { class: 'inkvis', points: pts, stroke: s.color, 'stroke-width': s.w, 'vector-effect': 'non-scaling-stroke' });
    const hit = svgEl('polyline', { class: 'inkhit', points: pts, 'vector-effect': 'non-scaling-stroke' });
    [vis, hit].forEach((x) => { x.dataset.ann = s.id; x.dataset.kind = 'ink'; x.dataset.page = n; }); return [vis, hit];
  }));
  rec.noteDiv.replaceChildren(...(a.sigs || []).map((sg) => makeSigEl(n, sg)), ...a.notes.map((nt) => {
    const m = el('div', { class: 'noteMark', title: nt.text, 'data-ann': nt.id, 'data-kind': 'notes', 'data-page': n, html: icon('note'), onclick: (e) => { if (S.tool === 'erase') return; e.stopPropagation(); openNoteEditor(n, nt.x, nt.y, nt, m); } });
    m.style.left = nt.x * 100 + '%'; m.style.top = nt.y * 100 + '%'; return m;
  }));
}
function addItem(kind, n, item, record = true) { annOf(n)[kind].push(item); renderAnn(n); if (record) pushUndo({ op: 'add', kind, n, item }); saveAnn(); }
function removeItem(kind, n, id, record = true) {
  const arr = annOf(n)[kind], i = arr.findIndex((x) => x.id === id); if (i < 0) return;
  const [item] = arr.splice(i, 1); renderAnn(n); if (record) pushUndo({ op: 'remove', kind, n, item, index: i }); saveAnn();
}
function pushUndo(op) { S.undo.push(op); S.redo = []; updateUndo(); }
function updateUndo() { $('#tUndo').disabled = !S.undo.length; $('#tRedo').disabled = !S.redo.length; }
function undo() { const op = S.undo.pop(); if (!op) return; if (op.op === 'doc') { swapDoc(op).then((rev) => { S.redo.push(rev); updateUndo(); }); return; } if (op.op === 'add') removeItem(op.kind, op.n, op.item.id, false); else { annOf(op.n)[op.kind].splice(op.index, 0, op.item); renderAnn(op.n); saveAnn(); } S.redo.push(op); updateUndo(); }
function redo() { const op = S.redo.pop(); if (!op) return; if (op.op === 'doc') { swapDoc(op).then((rev) => { S.undo.push(rev); updateUndo(); }); return; } if (op.op === 'add') { annOf(op.n)[op.kind].push(op.item); renderAnn(op.n); saveAnn(); } else removeItem(op.kind, op.n, op.item.id, false); S.undo.push(op); updateUndo(); }
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
function selectionToHighlight(color) {
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
  for (const [n, rs] of byPage) { addItem('hl', n, { id: uid(), color, rects: rs, text: first ? text : '…' }); first = false; }
  sel.removeAllRanges(); return true;
}
function hideSel() { $('#selPop').hidden = true; }
function showSelPop(sel) {
  const r = sel.getRangeAt(0).getBoundingClientRect(), pop = $('#selPop'), text = sel.toString(), page = pageOfNode(sel.anchorNode);
  pop.replaceChildren(
    ...HL_COLORS.map((c) => el('button', { class: 'swatch', style: `background:${c}`, title: 'Markieren', onmousedown: (e) => e.preventDefault(), onclick: () => { selectionToHighlight(c); hideSel(); } })),
    el('button', { class: 't', onmousedown: (e) => e.preventDefault(), onclick: () => { hideSel(); askClaude('explain', { selection: text, page }); } }, S.ai.name + ': Erklären'),
    el('button', { class: 't', onmousedown: (e) => e.preventDefault(), onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Kopiert', 1200); } catch (e) {} hideSel(); } }, 'Kopieren'));
  pop.hidden = false;
  const pw = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + 'px';
}
wrapEl.addEventListener('mouseup', () => setTimeout(() => {
  if (['draw', 'erase', 'note'].includes(S.tool)) return;
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.toString().trim() || !viewerEl.contains(sel.anchorNode)) return;
  if (S.tool === 'hl') { selectionToHighlight(S.hlColor); return; }
  showSelPop(sel);
}, 10));
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#selPop')) hideSel(); if (!e.target.closest('#notePop') && !e.target.closest('.noteMark')) closeNote(); if (!e.target.closest('#menuPop') && !e.target.closest('#zoomLabel') && !e.target.closest('#tClaude')) hideMenu(); });

// Zeichnen / Radieren / Kommentar
let drawing = null;
viewerEl.addEventListener('pointerdown', (e) => {
  if (S.tool === 'erase' && e.button === 0) { eraseAt(e); return; }
  if (S.tool !== 'draw' || e.button !== 0) return;
  const svg = e.target.closest?.('.inkLayer'); if (!svg) return;
  const b = svg.getBoundingClientRect(), pt = (ev) => [Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))];
  const live = svgEl('polyline', { class: 'inkvis', stroke: S.penColor, 'stroke-width': S.penW, 'vector-effect': 'non-scaling-stroke' }); svg.append(live);
  drawing = { n: +svg.dataset.page, pts: [pt(e)], live, pt, id: e.pointerId }; svg.setPointerCapture(e.pointerId); e.preventDefault();
});
viewerEl.addEventListener('pointermove', (e) => {
  if (S.tool === 'erase' && (e.buttons & 1)) { eraseAt(e); return; }
  if (!drawing || e.pointerId !== drawing.id) return;
  const p = drawing.pt(e), last = drawing.pts[drawing.pts.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0006) return;
  drawing.pts.push(p); drawing.live.setAttribute('points', drawing.pts.map((q) => q.join(',')).join(' '));
});
const endDraw = (e) => {
  if (!drawing || e.pointerId !== drawing.id) return;
  const d = drawing; drawing = null; d.live.remove();
  if (d.pts.length === 1) d.pts.push([d.pts[0][0] + 0.0004, d.pts[0][1]]);
  addItem('ink', d.n, { id: uid(), color: S.penColor, w: S.penW, pts: d.pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) });
};
viewerEl.addEventListener('pointerup', endDraw); viewerEl.addEventListener('pointercancel', endDraw);
function eraseAt(e) { for (const x of document.elementsFromPoint(e.clientX, e.clientY)) { const t = x.closest?.('[data-ann]'); if (t) { removeItem(t.dataset.kind, +t.dataset.page, t.dataset.ann); return; } } }

viewerEl.addEventListener('click', (e) => {
  if (S.tool !== 'note' || e.target.closest('.noteMark')) return;
  const pe = e.target.closest('.page'); if (!pe) return; const b = pe.getBoundingClientRect();
  openNoteEditor(+pe.dataset.page, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height, null, null, e.clientX, e.clientY);
});
function closeNote() { $('#notePop').hidden = true; }
function openNoteEditor(n, x, y, item, anchor, cx, cy) {
  const pop = $('#notePop'), ta = el('textarea', { placeholder: 'Kommentar …' }); ta.value = item?.text || '';
  const save = () => { const t = ta.value.trim(); if (item) { if (t) { item.text = t; renderAnn(n); saveAnn(); } else removeItem('notes', n, item.id); } else if (t) addItem('notes', n, { id: uid(), x, y, text: t }); closeNote(); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') closeNote(); });
  pop.replaceChildren(ta, el('div', { class: 'row' }, item ? el('button', { class: 'pillBtn', onclick: () => { removeItem('notes', n, item.id); closeNote(); } }, 'Löschen') : null, el('button', { class: 'pillBtn primary', onclick: save }, 'Speichern')));
  pop.hidden = false;
  const r = anchor ? anchor.getBoundingClientRect() : { left: cx, bottom: cy };
  pop.style.left = Math.min(innerWidth - 270, Math.max(8, r.left)) + 'px'; pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, (r.bottom || cy) + 8) + 'px'; ta.focus();
}

// Werkzeuge
function renderToolOpts() {
  const t = S.tool, o = $('#toolOpts'); o.replaceChildren();
  if (t === 'hl' || t === 'draw') {
    const cols = t === 'hl' ? HL_COLORS : PEN_COLORS, cur = t === 'hl' ? S.hlColor : S.penColor;
    o.append(el('span', {}, t === 'hl' ? 'Text auswählen zum Markieren:' : 'Farbe:'));
    cols.forEach((c) => o.append(el('button', { class: 'swatch' + (c === cur ? ' on' : ''), style: `background:${c}`, onclick: () => { if (t === 'hl') S.hlColor = c; else S.penColor = c; renderToolOpts(); } })));
    if (t === 'draw') { o.append(el('span', {}, 'Stärke')); const r = el('input', { type: 'range', min: 1, max: 12, value: S.penW }); r.oninput = () => { S.penW = +r.value; }; o.append(r); }
  } else if (t === 'erase') o.append(el('span', {}, 'Auf Markierung, Zeichnung oder Kommentar klicken oder darüberziehen.'));
  else if (t === 'note') o.append(el('span', {}, 'Auf die Seite klicken, um einen Kommentar zu setzen.'));
  else S.api.toolOptsExt?.(t, o);
  o.hidden = !o.childElementCount;
}
function setTool(t) {
  if (S.tool === t) t = 'select'; S.tool = t;
  document.body.className = document.body.className.replace(/\btool-\w+/g, '').trim() + ' tool-' + t;
  $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t)); renderToolOpts();
}
$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// Menü
function hideMenu() { $('#menuPop').hidden = true; }
function showMenu(x, y, items) {
  const m = $('#menuPop');
  m.replaceChildren(...items.map((it) => it === '-' ? el('div', { class: 'msep' }) : el('button', { class: 'mi', disabled: !!it.d, onclick: () => { hideMenu(); it.f && it.f(); } }, el('span', {}, it.l), it.k ? el('small', {}, it.k) : '')));
  m.hidden = false; m.scrollTop = 0; m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}

// ------------------------------------------------------------ KI-Anzeige (Name und Symbol der gewählten KI)
S.ai = { id: 'claude-code', name: 'KI', icon: null };
function applyAi(ai) {
  if (!ai) return;
  S.ai = ai;
  const b = $('#tClaude'); if (!b) return;
  b.title = 'Aufgabe an ' + ai.name + ' geben';
  b.querySelector('.lbl').textContent = ai.name;
  const old = b.querySelector('.ic, .aiIcon, .aiBadge');
  let n;
  if (ai.icon) n = el('img', { class: 'aiIcon', src: ai.icon, alt: '' });
  else if (ai.name && ai.name !== 'KI') { n = el('span', { class: 'aiBadge' }, ai.name[0].toUpperCase()); let h = 0; for (const c of ai.name) h = (h * 31 + c.charCodeAt(0)) % 360; n.style.background = `hsl(${h} 55% 42%)`; }
  else { n = el('span', { class: 'ic' }); n.innerHTML = icon('spark'); }
  old.replaceWith(n);
}
S.api.applyAi = applyAi;
window.addEventListener('message', (e) => { if (e.data?.type === 'ai') applyAi(e.data.ai); });

// ------------------------------------------------------------ Claude
async function askClaude(kind, extra = {}) {
  if (!S.pdf) return;
  flushAnn();
  if (kind !== 'explain') { toast('Text wird für ' + S.ai.name + ' vorbereitet …', 4000); }
  await textsReady; await sleep(350);
  post({ type: 'claude', kind, page: extra.page ?? S.cur, selection: extra.selection, count: extra.count });
}
function countDialog(kind, label) {
  const sel = el('select', {}, ...[5, 8, 12, 20].map((v) => el('option', { value: v, selected: v === 8 }, v)));
  modal({ title: label, body: el('label', { class: 'muted' }, 'Anzahl ', sel), actions: [{ label: 'Abbrechen' }, { label: 'An ' + S.ai.name + ' senden', primary: true, onClick: () => askClaude(kind, { count: +sel.value }) }] });
}
$('#tClaude').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { l: 'Diese Seite zusammenfassen', f: () => askClaude('summary-page') },
    { l: 'Ganze PDF zusammenfassen', f: () => askClaude('summary-doc') },
    { l: 'Lernzettel erstellen', f: () => askClaude('learn') },
    { l: 'Quiz erstellen …', f: () => countDialog('quiz', 'Quiz erstellen') },
    { l: 'Karteikarten mit ' + S.ai.name + ' …', f: () => countDialog('cards', 'Karteikarten erstellen') },
    '-',
    { l: 'Frage zur PDF stellen', f: () => askClaude('ask') },
    '-',
    { l: 'KI wechseln … (jetzt: ' + S.ai.name + ')', f: () => post({ type: 'chooseAi' }) },
    { l: 'PDF-Werkzeuge für die KI einrichten …', f: () => post({ type: 'setupMcp' }) }
  ]);
};

// ------------------------------------------------------------ Karteikarten aus Markierungen
const esre = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function highlights() { const out = []; Object.keys(S.ann).map(Number).sort((a, b) => a - b).forEach((n) => S.ann[n].hl.filter((h) => h.text && h.text !== '…').forEach((h) => out.push({ page: n, text: h.text }))); return out; }
function clozeCards(hl, texts) {
  return hl.map((h) => {
    const t = h.text.replace(/\s+/g, ' ').trim(), pt = (texts[h.page - 1] || '').replace(/\s+/g, ' ');
    if (t.length > 140) return { front: `Seite ${h.page}: Wie geht die markierte Stelle weiter, die beginnt mit „${t.split(' ').slice(0, 6).join(' ')} …“?`, back: t, page: h.page };
    const idx = pt.toLowerCase().indexOf(t.toLowerCase());
    if (idx < 0) return { front: `Seite ${h.page}: Ergänze die markierte Stelle.`, back: t, page: h.page };
    let s = pt.lastIndexOf('. ', idx); s = s < 0 ? 0 : s + 2; let e = pt.indexOf('. ', idx + t.length); e = e < 0 ? pt.length : e + 1;
    let sentence = pt.slice(s, e); if (sentence.length > 380) sentence = pt.slice(Math.max(0, idx - 130), idx + t.length + 130);
    return { front: sentence.replace(new RegExp(esre(t), 'i'), '[ … ]'), back: t, page: h.page };
  });
}
async function cards() {
  const hl = highlights();
  if (!hl.length) { toast('Markiere zuerst Stellen im Text. Daraus werden die Karteikarten.', 4500); return; }
  runCards(clozeCards(hl, await getAllTexts()));
}
function runCards(deck) {
  deck = deck.slice(); let i = 0, known = 0; const total = deck.length, body = el('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const m = modal({ title: 'Karteikarten', body, wide: true, actions: [] });
  function show() {
    body.replaceChildren();
    if (i >= deck.length) { body.append(el('p', { class: 'qq' }, `Fertig – ${known} von ${total} Karten gewusst.`), el('div', { class: 'row' }, el('button', { class: 'pillBtn primary', onclick: () => m.close() }, 'Schließen'))); return; }
    const c = deck[i]; let flipped = false;
    const card = el('div', { class: 'card', onclick: flip }, el('div', {}, el('small', {}, 'Vorderseite' + (c.page ? ` · S. ${c.page}` : '')), c.front));
    function flip() { flipped = !flipped; card.replaceChildren(el('div', {}, el('small', {}, flipped ? 'Rückseite' : 'Vorderseite'), flipped ? c.back : c.front)); btns.hidden = !flipped; }
    const btns = el('div', { class: 'row', hidden: true }, el('button', { class: 'pillBtn', onclick: () => { deck.push(c); i++; show(); } }, 'Nochmal'), el('button', { class: 'pillBtn primary', onclick: () => { known++; i++; show(); } }, 'Gewusst'));
    body.append(el('div', { class: 'progress' }, el('i', { style: `width:${(Math.min(i, total) / Math.max(total, deck.length)) * 100}%` })), el('p', { class: 'muted' }, `Karte ${i + 1} von ${deck.length} – zum Umdrehen klicken`), card, btns);
  }
  show();
}
$('#tCards').onclick = cards;

// ------------------------------------------------------------ Speichern / Markierungen
$('#tMarks').onclick = async () => { flushAnn(); await sleep(250); post({ type: 'openMarks' }); };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const winAnsi = (s) => s.replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');
async function buildAnnotatedPdf() {
  const doc = await PDFDocument.load(S.bytes.slice(), { ignoreEncryption: true }), font = await doc.embedFont(StandardFonts.Helvetica), pages = doc.getPages();
  for (const [key, a] of Object.entries(S.ann)) {
    const pg = pages[+key - 1]; if (!pg) continue;
    const { width: W, height: H } = pg.getSize(), r = ((pg.getRotation().angle % 360) + 360) % 360, dw = r % 180 ? H : W, dh = r % 180 ? W : H;
    const P = (u, v) => toPdf(u, v, W, H, r);                       // normalisiert (Anzeige) -> PDF
    const D = (x, y) => P(x / dw, y / dh);                          // Punkt der Anzeige (pt, von oben links) -> PDF
    (a.hl || []).forEach((h) => h.rects.forEach(([x, y, w, hh]) => {
      const p1 = P(x, y), p2 = P(x + w, y + hh), x0 = Math.min(p1[0], p2[0]), y0 = Math.min(p1[1], p2[1]);
      pg.drawRectangle({ x: x0, y: y0, width: Math.abs(p1[0] - p2[0]), height: Math.abs(p1[1] - p2[1]), color: hexRgb(h.color), blendMode: BlendMode.Multiply });
    }));
    (a.ink || []).forEach((s) => { for (let i = 1; i < s.pts.length; i++) { const p = P(...s.pts[i - 1]), q = P(...s.pts[i]); pg.drawLine({ start: { x: p[0], y: p[1] }, end: { x: q[0], y: q[1] }, thickness: s.w * 0.75, color: hexRgb(s.color), lineCap: LineCapStyle.Round }); } });
    (a.notes || []).forEach((nt) => {
      const x = nt.x * dw, y = nt.y * dh, size = 8, maxW = 150, words = winAnsi(nt.text).split(/\s+/), lines = []; let line = '';
      words.forEach((w) => { const t = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; } else line = t; }); if (line) lines.push(line);
      const bh = lines.length * (size + 2) + 6, bx = Math.min(x + 6, dw - maxW - 10), by = Math.min(dh - 4, y + bh); // by = Unterkante in Anzeige-Koordinaten (von oben)
      const o = D(bx, by); pg.drawRectangle({ x: o[0], y: o[1], width: maxW + 8, height: bh, rotate: degrees(r), color: rgb(1, 0.95, 0.55), borderColor: rgb(0.8, 0.65, 0), borderWidth: 0.6 });
      lines.forEach((l, i) => { const q = D(bx + 4, by - bh + 9 + i * (size + 2)); pg.drawText(l, { x: q[0], y: q[1], size, font, rotate: degrees(r), color: rgb(0.1, 0.1, 0.1) }); });
      const c = D(x, y); pg.drawCircle({ x: c[0], y: c[1], size: 3.5, color: rgb(0.99, 0.84, 0.2), borderColor: rgb(0.6, 0.45, 0), borderWidth: 0.6 });
    });
    for (const sg of (a.sigs || [])) {
      const img = await doc.embedPng(sg.img), o = D(sg.x * dw, (sg.y + sg.h) * dh);
      pg.drawImage(img, { x: o[0], y: o[1], width: sg.w * dw, height: sg.h * dh, rotate: degrees(r) });
    }
  }
  return await doc.save();
}
function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
$('#tSave').onclick = async () => {
  try { toast('Kopie wird erstellt …', 3000); post({ type: 'saveCopy', b64: toB64(await buildAnnotatedPdf()) }); }
  catch (e) { toast('Fehler: ' + (e.message || e), 5000); }
};

// Tastatur
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable, mod = e.ctrlKey || e.metaKey;
  if (!typing && mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (!typing && mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (!typing && !mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'h') setTool('hl'); else if (k === 'd') setTool('draw'); else if (k === 'e') setTool('erase'); else if (k === 'c') setTool('note');
    else if (e.key === 'Escape') { S.tool !== 'select' && setTool(S.tool); hideMenu(); closeNote(); hideSel(); }
  }
});


// ------------------------------------------------------------ Fehler melden
async function reportDialog(kind) {
  let pdf = null;
  if (S.pdf) {
    pdf = { Seiten: S.pdf.numPages, 'Größe (KB)': Math.round((S.bytes?.length || 0) / 1024) };
    try { const i = (await S.pdf.getMetadata()).info || {}; if (i.Producer) pdf['Ersteller-Programm'] = String(i.Producer).slice(0, 80); if (i.PDFFormatVersion) pdf['PDF-Version'] = i.PDFFormatVersion; } catch (e) { /* ohne */ }
  }
  post({ type: 'report', kind, pdf });
}
window.addEventListener('error', (e) => post({ type: 'jsError', message: String(e.message || '').slice(0, 300) }));
window.addEventListener('unhandledrejection', (e) => post({ type: 'jsError', message: String(e.reason?.message || e.reason || '').slice(0, 300) }));

// ------------------------------------------------------------ Werkzeuge-Menü, Speichern
$('#tTools').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { l: 'PDFs zusammenfügen …', f: mergeDialog },
    { l: 'PDF aufteilen …', f: splitDialog },
    { l: 'Seiten aus PDF einfügen …', f: () => insertFrom(S.cur) },
    { l: 'Seiten zuschneiden …', f: cropDialog },
    { l: 'Seitenzahlen einfügen …', f: numberDialog },
    { l: 'Texterkennung (OCR) …', f: () => ocrDialog().catch((e) => toast('Fehler: ' + (e.message || e), 6000)) },
    { l: 'Komprimieren …', f: compressDialog },
    '-',
    { l: 'Schwärzen', f: () => setTool('redact') },
    { l: 'Unterschrift setzen', f: () => setTool('sign') },
    '-',
    { l: 'Fehler melden …', f: () => reportDialog('bug') },
    { l: 'Feedback geben …', f: () => reportDialog('praise') },
    { l: 'Lizenzen …', f: () => post({ type: 'licenses' }) }
  ]);
};
$('#tFile').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [{ l: 'Speichern (Datei überschreiben)', f: saveFile }, { l: 'Speichern unter …', f: saveAs }]);
};
Object.assign(S.api, { reload, request, post, showMenu, goTo, flushAnn, saveAnn, getAllTexts, updateUndo, renderToolOpts, addItem, setTool });
initPages(); initTools();
S.tool = 'none'; setTool('select');
window.__werkbank = { S, getAllTexts };
start();

// Werkzeugleiste: Mausrad scrollt seitwärts, wenn das Fenster zu schmal ist
{
  const bar = $('#bar');
  if (bar) bar.addEventListener('wheel', (e) => { if (bar.scrollWidth > bar.clientWidth && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) { bar.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
}
