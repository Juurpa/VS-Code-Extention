// "Text recognition (OCR)" dialog. Recognition itself runs in the extension (local, no internet).
import { S, el, toast, modal } from './util.js';
import { commit, toB64, b64ToBytes } from './pages.js';
import { t } from './i18n.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);

export async function ocrDialog() {
  toast(t('Checking pages …'), 1500);
  const scan = await S.api.request({ type: 'ocrScan', b64: toB64(S.bytes) });
  if (!scan.ok) throw new Error(scan.error || t('Check failed.'));
  const noText = scan.pages.filter((p) => p.scanned).map((p) => p.page), total = scan.pages.length;

  const which = el('select', {},
    el('option', { value: 'scan' }, noText.length ? t('Pages without text ({n} of {total})', { n: noText.length, total }) : t('Pages without text (none found)')),
    el('option', { value: 'all' }, t('All pages')),
    el('option', { value: 'cur' }, t('This page only ({n})', { n: S.cur })));
  which.value = noText.length ? 'scan' : 'cur';
  const lang = el('select', {}, el('option', { value: 'deu,eng' }, t('German and English')), el('option', { value: 'deu' }, t('German only')), el('option', { value: 'eng' }, t('English only')));
  const qual = el('select', {}, el('option', { value: 'good' }, t('Good – more accurate, also handles tables (about 10–25 s per page)')), el('option', { value: 'fast' }, t('Fast – for clean scans (about half the time)')));
  const note = el('p', { class: 'muted' }, noText.length
    ? t('The image stays unchanged. The recognized text sits invisibly behind it, so you can then search, select, copy and redact it. Everything runs on your computer; nothing is uploaded. Limits: handwriting and formulas are not recognized reliably, and scans with shadows or skew can lower accuracy.')
    : t('All pages already have text. You can still run recognition on individual pages; text is only added there. Limits: handwriting and formulas are not recognized reliably, and scans with shadows or skew can lower accuracy.'));
  const bar = el('progress', { max: '1', value: '0', style: 'width:100%' }), status = el('div', { class: 'muted' }, '');
  const prog = el('div', { class: 'stack', hidden: true }, bar, status);
  const form = el('div', { class: 'stack' }, note, field(t('Pages'), which), field(t('Language'), lang), field(t('Quality'), qual));

  let running = null;
  const m = modal({
    title: t('Text recognition (OCR)'), body: el('div', {}, form, prog),
    actions: [{ label: t('Close'), onClick: () => { if (running) { S.api.post({ type: 'ocrCancel', rid: running.rid }); } } },
      { label: t('Start'), primary: true, close: false, onClick: (api) => { start(api); return false; } }]
  });
  const startBtn = m.bar.querySelector('.primary');

  async function start(api) {
    const pages = which.value === 'scan' ? noText : which.value === 'cur' ? [S.cur] : null;
    if (which.value === 'scan' && !noText.length) { toast(t('No page without text found.'), 3500); return; }
    startBtn.disabled = true; form.hidden = true; prog.hidden = false; status.textContent = t('Starting text recognition …');
    const n = pages ? pages.length : total;
    const pr = S.api.request({ type: 'ocr', b64: toB64(S.bytes), pages, langs: lang.value.split(','), fast: qual.value === 'fast', force: which.value !== 'scan' }, (p) => {
      bar.value = p.done / p.total; status.textContent = t('Page {page} done ({done} of {total}) …', { page: p.page, done: p.done, total: p.total });
    });
    running = pr; bar.max = '1'; status.textContent = n === 1 ? t('Recognizing text …') : t('Recognizing first of {n} pages …', { n });
    const r = await pr; running = null;
    if (!r.ok) { api.close(); toast(r.error === 'Cancelled.' ? t('Text recognition cancelled, nothing changed.') : 'Error: ' + r.error, 6000); return; }
    api.close();
    if (!r.b64) { toast(r.message || t('No page needed text recognition.'), 5000); return; }
    await commit(b64ToBytes(r.b64), S.ann || {});
    const words = r.pages.reduce((a, p) => a + p.words, 0), low = r.pages.filter((p) => p.lowConf).map((p) => p.page), turned = r.pages.filter((p) => p.turned).map((p) => p.page);
    toast((r.pages.length === 1 ? t('Text recognized on {n} page ({words} words).', { n: r.pages.length, words }) : t('Text recognized on {n} pages ({words} words).', { n: r.pages.length, words })) + (turned.length ? ' ' + t('Scanned rotated: page {pages}.', { pages: turned.join(', ') }) : '') + (low.length ? ' ' + t('Low-confidence recognition on page {pages}: please check.', { pages: low.join(', ') }) : ''), 10000);
  }
}
