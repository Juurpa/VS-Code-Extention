// "Text recognition (OCR)" dialog. Recognition itself runs in the extension (local, no internet).
import { S, el, toast, modal } from './util.js';
import { commit, toB64, b64ToBytes } from './pages.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);

export async function ocrDialog() {
  toast('Checking pages …', 1500);
  const scan = await S.api.request({ type: 'ocrScan', b64: toB64(S.bytes) });
  if (!scan.ok) throw new Error(scan.error || 'Check failed.');
  const noText = scan.pages.filter((p) => p.scanned).map((p) => p.page), total = scan.pages.length;

  const which = el('select', {},
    el('option', { value: 'scan' }, noText.length ? `Pages without text (${noText.length} of ${total})` : 'Pages without text (none found)'),
    el('option', { value: 'all' }, 'All pages'),
    el('option', { value: 'cur' }, 'This page only (' + S.cur + ')'));
  which.value = noText.length ? 'scan' : 'cur';
  const lang = el('select', {}, el('option', { value: 'deu,eng' }, 'German and English'), el('option', { value: 'deu' }, 'German only'), el('option', { value: 'eng' }, 'English only'));
  const qual = el('select', {}, el('option', { value: 'good' }, 'Good – more accurate, also handles tables (about 10–25 s per page)'), el('option', { value: 'fast' }, 'Fast – for clean scans (about half the time)'));
  const note = el('p', { class: 'muted' }, noText.length
    ? 'The image stays unchanged. The recognized text sits invisibly behind it, so you can then search, select, copy and redact it. Everything runs on your computer; nothing is uploaded. Limits: handwriting and formulas are not recognized reliably, and scans with shadows or skew can lower accuracy.'
    : 'All pages already have text. You can still run recognition on individual pages; text is only added there. Limits: handwriting and formulas are not recognized reliably, and scans with shadows or skew can lower accuracy.');
  const bar = el('progress', { max: '1', value: '0', style: 'width:100%' }), status = el('div', { class: 'muted' }, '');
  const prog = el('div', { class: 'stack', hidden: true }, bar, status);
  const form = el('div', { class: 'stack' }, note, field('Pages', which), field('Language', lang), field('Quality', qual));

  let running = null;
  const m = modal({
    title: 'Text recognition (OCR)', body: el('div', {}, form, prog),
    actions: [{ label: 'Close', onClick: () => { if (running) { S.api.post({ type: 'ocrCancel', rid: running.rid }); } } },
      { label: 'Start', primary: true, close: false, onClick: (api) => { start(api); return false; } }]
  });
  const startBtn = m.bar.querySelector('.primary');

  async function start(api) {
    const pages = which.value === 'scan' ? noText : which.value === 'cur' ? [S.cur] : null;
    if (which.value === 'scan' && !noText.length) { toast('No page without text found.', 3500); return; }
    startBtn.disabled = true; form.hidden = true; prog.hidden = false; status.textContent = 'Starting text recognition …';
    const n = pages ? pages.length : total;
    const pr = S.api.request({ type: 'ocr', b64: toB64(S.bytes), pages, langs: lang.value.split(','), fast: qual.value === 'fast', force: which.value !== 'scan' }, (p) => {
      bar.value = p.done / p.total; status.textContent = `Page ${p.page} done (${p.done} of ${p.total}) …`;
    });
    running = pr; bar.max = '1'; status.textContent = `Recognizing first of ${n} pages …`;
    const r = await pr; running = null;
    if (!r.ok) { api.close(); toast(r.error === 'Cancelled.' ? 'Text recognition cancelled, nothing changed.' : 'Error: ' + r.error, 6000); return; }
    api.close();
    if (!r.b64) { toast(r.message || 'No page needed text recognition.', 5000); return; }
    await commit(b64ToBytes(r.b64), S.ann || {});
    const words = r.pages.reduce((a, p) => a + p.words, 0), low = r.pages.filter((p) => p.lowConf).map((p) => p.page), turned = r.pages.filter((p) => p.turned).map((p) => p.page);
    toast(`Text recognized on ${r.pages.length} ${r.pages.length === 1 ? 'page' : 'pages'} (${words} words).` + (turned.length ? ` Scanned rotated: page ${turned.join(', ')}.` : '') + (low.length ? ` Low-confidence recognition on page ${low.join(', ')}: please check.` : ''), 10000);
  }
}
