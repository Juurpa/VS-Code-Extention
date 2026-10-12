// Page-view tools: redaction and signature
import * as ops from './pdfops.js';
import { S, $, $$, el, modal, toast, uid } from './util.js';
import { commit, toB64, b64ToBytes } from './pages.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
S.red = {}; S.sig = null;

// ------------------------------------------------------------ Redaction
const redCount = () => Object.values(S.red).reduce((a, r) => a + r.length, 0);
export function drawRed(rec) {
  const list = S.red[rec.n] || [];
  rec.redDiv.replaceChildren(...list.map((r, i) => {
    const d = el('div', { class: 'redBox', title: 'Click to remove', onclick: (e) => { if (S.tool !== 'redact') return; e.stopPropagation(); list.splice(i, 1); if (!list.length) delete S.red[rec.n]; drawRed(rec); S.api.renderToolOpts(); } });
    d.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%`; return d;
  }));
}
const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

async function applyRedactions() {
  const pages = Object.keys(S.red).map(Number); if (!pages.length) return;
  const ann = clone(S.ann);
  const info = el('p', {}, 'Redacting and verifying …');
  const m = modal({ title: 'Redact', body: info, actions: [] });
  try {
    const boxes = [];
    for (const n of pages) {
      S.red[n].forEach(([x, y, w, h]) => boxes.push({ page: n, x, y, w, h }));
      // Remove highlights, drawings, comments and signatures under the areas (no text leak)
      const a = ann[n]; if (a) {
        const R = S.red[n];
        a.hl = (a.hl || []).filter((h) => !h.rects.some((r) => R.some((q) => hit(r, q))));
        a.ink = (a.ink || []).filter((s) => { const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]); const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; return !R.some((q) => hit(bb, q)); });
        a.notes = (a.notes || []).filter((nt) => !R.some((q) => hit([nt.x, nt.y, 0.001, 0.001], q)));
        a.sigs = (a.sigs || []).filter((s) => !R.some((q) => hit([s.x, s.y, s.w, s.h], q)));
      }
    }
    const r = await S.api.request({ type: 'redact', b64: toB64(S.bytes), boxes });
    if (!r.ok) throw new Error(r.error || 'Redaction failed.');
    if (r.verification && !r.verification.ok) throw new Error('Verification failed: redacted text is still in the file. Nothing was applied.');
    if (!r.b64) throw new Error('No response received.');
    S.red = {};
    await commit(b64ToBytes(r.b64), ann);
    S.api.renderToolOpts?.();
    const img = (r.modes || []).filter((m) => m.reason);
    toast(`Redacted on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} and verified: the text under the bars is removed, the rest of the page is unchanged.` + (img.length ? ` Page ${img.map((m) => m.page).join(', ')} had to be rebuilt as an image (${img[0].reason}); the text stays selectable there.` : ''), 9000);
  } finally { m.close(); }
}

// ------------------------------------------------------------ Signature
function trimCanvas(c) {
  const g = c.getContext('2d'), { width: w, height: h } = c, d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6, o = document.createElement('canvas'); o.width = x1 - x0 + 2 * pad; o.height = y1 - y0 + 2 * pad;
  o.getContext('2d').drawImage(c, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0); return o;
}
export function signatureDialog(then) {
  const c = el('canvas', { width: 560, height: 200, class: 'sigPad' }), g = c.getContext('2d');
  g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
  let down = false, last = null;
  const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  c.addEventListener('pointerdown', (e) => { down = true; last = pt(e); c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...last); g.lineTo(last[0] + 0.1, last[1]); g.stroke(); });
  c.addEventListener('pointermove', (e) => { if (!down) return; const p = pt(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; });
  const up = () => { down = false; }; c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  file.onchange = () => {
    const f = file.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => {
      g.clearRect(0, 0, c.width, c.height); const s = Math.min(c.width / img.width, c.height / img.height, 1);
      g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
      // make light pixels (white background) transparent
      const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const lum = (d[i] + d[i + 1] + d[i + 2]) / 3; if (lum > 225) d[i + 3] = 0; else if (lum > 170) d[i + 3] = Math.round(d[i + 3] * (225 - lum) / 55); }
      g.putImageData(id, 0, 0);
    }; img.src = URL.createObjectURL(f);
  };
  modal({ title: 'Signature', wide: true, body: el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Sign with the mouse or a pen – or load a photo of your signature (a light background becomes transparent). This is a simple image signature and is not legally equivalent to a handwritten (written-form) signature.'), c, file,
    el('div', { class: 'row', style: 'justify-content:flex-start' }, el('button', { class: 'pillBtn', onclick: () => g.clearRect(0, 0, c.width, c.height) }, 'Clear'), el('button', { class: 'pillBtn', onclick: () => file.click() }, 'Load image …'))),
    actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => {
      const t = trimCanvas(c); if (!t) { toast('Please sign first.'); return false; }
      S.sig = t.toDataURL('image/png'); S.api.post({ type: 'saveSig', png: S.sig }); S.api.renderToolOpts(); then && then();
    } }] });
}

// Signature element on the page (movable, resize via the corner)
export function makeSigEl(n, s) {
  const box = el('div', { class: 'sigMark', 'data-ann': s.id, 'data-kind': 'sigs', 'data-page': n, title: 'Drag to move, corner to resize; eraser removes' });
  const img = el('img', { src: s.img, draggable: false }); const handle = el('i', { class: 'sigHandle' }); box.append(img, handle);
  const place = () => { box.style.cssText = `left:${s.x * 100}%;top:${s.y * 100}%;width:${s.w * 100}%;height:${s.h * 100}%`; };
  place();
  const pageEl = () => box.closest('.page');
  const drag = (resize) => (e) => {
    if (S.tool === 'erase') return; e.preventDefault(); e.stopPropagation();
    const pr = pageEl().getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { x: s.x, y: s.y, w: s.w, h: s.h }, ratio = o.h / o.w * (pr.height ? pr.width / pr.height : 1) ;
    box.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height;
      if (resize) { s.w = Math.min(1 - s.x, Math.max(0.04, o.w + dx)); s.h = s.w * o.h / o.w * 1; void ratio; }
      else { s.x = Math.min(1 - s.w, Math.max(0, o.x + dx)); s.y = Math.min(1 - s.h, Math.max(0, o.y + dy)); }
      place();
    };
    const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); S.api.saveAnn(); };
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
  };
  handle.addEventListener('pointerdown', drag(true)); img.addEventListener('pointerdown', drag(false));
  return box;
}

function placeSignature(e) {
  if (S.tool !== 'sign' || !S.sig) return;
  const pe = e.target.closest('.page'); if (!pe) return;
  const b = pe.getBoundingClientRect(), n = +pe.dataset.page, im = new Image();
  im.onload = () => {
    const w = 0.28, h = w * (im.height / im.width) * (b.width / b.height);
    const x = Math.min(1 - w, Math.max(0, (e.clientX - b.left) / b.width - w / 2)), y = Math.min(1 - h, Math.max(0, (e.clientY - b.top) / b.height - h / 2));
    S.api.addItem('sigs', n, { id: uid(), x, y, w, h, img: S.sig });
    S.api.setTool('sign');
    toast('Signature placed. To burn it in: "Save copy with annotations".', 5000);
  };
  im.src = S.sig;
}

// ------------------------------------------------------------ Toolbar options
export function toolOpts(t, o) {
  if (t === 'redact') {
    const n = redCount();
    o.append(el('span', {}, n ? `${n} ${n === 1 ? 'area' : 'areas'} marked.` : 'Drag areas over the text that should disappear.'),
      el('button', { class: 'pillBtn primary', disabled: !n, onclick: () => applyRedactions().catch((e) => toast('Error: ' + (e.message || e), 6000)) }, 'Apply redaction'),
      el('button', { class: 'pillBtn', disabled: !n, onclick: () => { S.red = {}; S.pages.forEach(drawRed); S.api.renderToolOpts(); } }, 'Reset'),
      el('span', { class: 'muted' }, 'The text under the bars is removed and verified. The remaining text stays searchable.'));
  } else if (t === 'sign') {
    o.append(S.sig ? el('img', { src: S.sig, class: 'sigPrev' }) : null,
      el('span', {}, S.sig ? 'Click on the page to place the signature.' : 'No signature created yet.'),
      el('button', { class: 'pillBtn', onclick: () => signatureDialog() }, S.sig ? 'Create new …' : 'Create signature …'));
    if (!S.sig) signatureDialog();
  }
}

export function initTools() {
  let drag = null;
  const viewer = $('#viewer');
  viewer.addEventListener('pointerdown', (e) => {
    if (S.tool !== 'redact' || e.button !== 0) return;
    const pe = e.target.closest('.page'); if (!pe || e.target.closest('.redBox')) return;
    const b = pe.getBoundingClientRect(), n = +pe.dataset.page, rec = S.pages[n - 1];
    const pt = (ev) => [Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))];
    const p0 = pt(e), live = el('div', { class: 'redBox live' }); rec.redDiv.append(live);
    drag = { n, p0, live, pt, id: e.pointerId }; pe.setPointerCapture(e.pointerId); e.preventDefault();
  });
  viewer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = drag.pt(e), x = Math.min(p[0], drag.p0[0]), y = Math.min(p[1], drag.p0[1]), w = Math.abs(p[0] - drag.p0[0]), h = Math.abs(p[1] - drag.p0[1]);
    drag.live.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`; drag.r = [x, y, w, h];
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; d.live.remove();
    if (d.r && d.r[2] > 0.004 && d.r[3] > 0.003) { (S.red[d.n] ||= []).push(d.r); drawRed(S.pages[d.n - 1]); S.api.renderToolOpts(); }
  };
  viewer.addEventListener('pointerup', end); viewer.addEventListener('pointercancel', end);
  viewer.addEventListener('click', placeSignature);
  S.api.toolOptsExt = toolOpts;
}
