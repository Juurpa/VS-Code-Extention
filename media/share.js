// File menu: save, save as, copy with annotations (choose place and name), print, e-mail, show in folder.
// Printing and e-mail hand a prepared file to the system; the user prints or presses "Send" there.
import { S, $, el, modal, toast } from './util.js';
import { toB64, saveFile, saveAs } from './pages.js';
import * as ops from './pdfops.js';
import { buildPdf } from './annots.js';
import { t } from './i18n.js';

const baseName = () => S.name.replace(/\.pdf$/i, '');
const hasAnn = () => Object.values(S.ann || {}).some((a) => ['hl', 'ink', 'notes', 'sigs', 'texts', 'imgs'].some((k) => (a[k] || []).length));
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
const radio = (name, value, label, checked, hint) => el('label', { class: 'opt radio' }, el('input', { type: 'radio', name, value, checked }), el('span', {}, el('b', {}, label), hint ? el('small', { class: 'muted' }, hint) : null));
const picked = (box, name) => box.querySelector(`input[name="${name}"]:checked`)?.value;

/** Builds the document as it should leave the viewer. how: 'plain' | 'burn' | 'annots'; pages: 0-based indices or null. */
export async function exportBytes(how, pages) {
  S.api.flushAnn();
  let bytes = how === 'plain' ? S.bytes.slice() : await buildPdf(S.bytes, S.ann, { mode: how, author: S.author || 'PDF Workbench' });
  if (pages && pages.length && pages.length < S.pages.length) bytes = await ops.extract(bytes, pages);
  return bytes;
}
function parsePages(spec) {
  const out = [], n = S.pages.length;
  for (const part of String(spec).split(/[,;]\s*/)) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$/.exec(part); if (!m) continue;
    const a = Math.max(1, +m[1]), b = m[2] === undefined ? a : (m[2] === '' ? n : Math.min(n, +m[2]));
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  return out;
}
const howChoices = (name, def) => el('div', { class: 'stack tight' },
  radio(name, 'burn', t('With annotations, burned in'), def === 'burn', t('Looks the same everywhere; highlights can no longer be changed.')),
  radio(name, 'annots', t('With annotations as PDF comments'), def === 'annots', t('Acrobat, Edge, Preview … show and edit them. Text boxes, images and signatures are burned in.')),
  radio(name, 'plain', t('Without annotations'), def === 'plain', t('Only the document (including page changes and edited text).')));
const pageChoice = () => {
  const sel = el('select', {}, el('option', { value: 'all' }, t('All pages ({n})', { n: S.pages.length })), el('option', { value: 'cur' }, t('Current page ({n})', { n: S.cur })), ...(S.sel?.size > 1 ? [el('option', { value: 'sel' }, t('Selected pages ({n})', { n: S.sel.size }))] : []), el('option', { value: 'range' }, t('Pages …')));
  const rng = el('input', { type: 'text', placeholder: '1-3, 5', hidden: true });
  sel.onchange = () => { rng.hidden = sel.value !== 'range'; if (!rng.hidden) rng.focus(); };
  const get = () => sel.value === 'all' ? null : sel.value === 'cur' ? [S.cur - 1] : sel.value === 'sel' ? [...S.sel].sort((a, b) => a - b).map((n) => n - 1) : parsePages(rng.value);
  return { node: el('div', { class: 'row', style: 'justify-content:flex-start' }, sel, rng), get };
};

// ------------------------------------------------------------ Copy with annotations
export function copyDialog() {
  const box = howChoices('how', 'burn');
  modal({ title: t('Save a copy'), body: el('div', { class: 'stack' }, el('p', { class: 'muted' }, t('The original stays unchanged. You choose the folder and the name in the next step.')), box),
    actions: [{ label: t('Cancel') }, { label: t('Choose place and name …'), primary: true, onClick: () => { saveCopy(picked(box, 'how')); } }] });
}
async function saveCopy(how) {
  try {
    const bytes = await exportBytes(how);
    const suffix = how === 'plain' ? t('copy') : t('annotated');
    const r = await S.api.request({ type: 'saveCopyAs', b64: toB64(bytes), suggested: `${baseName()}_${suffix}.pdf`, title: t('Save a copy') });
    if (r.ok) toast(t('Saved: {names}', { names: r.name }), 4000);
  } catch (e) { toast('Error: ' + (e.message || e), 6000); }
}

// ------------------------------------------------------------ Print
export function printDialog() {
  const box = howChoices('phow', hasAnn() ? 'burn' : 'plain'), pg = pageChoice();
  modal({ title: t('Print'), body: el('div', { class: 'stack' }, box, field(t('Pages'), pg.node),
    el('p', { class: 'muted' }, t('VS Code cannot print by itself. The prepared PDF opens in your PDF program (e.g. Edge or Acrobat); print it there with Ctrl+P.'))),
  actions: [{ label: t('Cancel') }, { label: t('Open for printing'), primary: true, onClick: () => {
    (async () => {
      try {
        const pages = pg.get(); if (pages && !pages.length) { toast(t('Please enter pages, e.g. 1-3, 5.')); return; }
        const bytes = await exportBytes(picked(box, 'phow'), pages);
        const r = await S.api.request({ type: 'print', b64: toB64(bytes), name: `${baseName()}_${t('print')}.pdf` });
        toast(r.ok ? t('Opened in your PDF program – print with Ctrl+P.') : t('No program for PDF files found.'), 6000);
      } catch (e) { toast('Error: ' + (e.message || e), 6000); }
    })();
  } }] });
}

// ------------------------------------------------------------ E-mail
export function mailDialog() {
  const to = el('input', { type: 'email', placeholder: t('name@example.com (optional)') });
  const subject = el('input', { type: 'text', value: S.name });
  const body = el('textarea', { rows: 5 }); body.value = t('Hello,\n\nplease find attached "{name}".\n\nBest regards', { name: S.name });
  const box = howChoices('mhow', hasAnn() ? 'burn' : 'plain'), pg = pageChoice();
  const fname = el('input', { type: 'text', value: S.name });
  modal({ title: t('Send by e-mail'), wide: true, body: el('div', { class: 'mailDlg' },
    el('div', { class: 'stack' }, field(t('To'), to), field(t('Subject'), subject), field(t('Message'), body)),
    el('div', { class: 'stack' }, el('b', {}, t('Attachment')), box, field(t('Pages'), pg.node), field(t('File name'), fname),
      el('p', { class: 'muted' }, t('A draft with the PDF attached opens in your mail program (Outlook, Thunderbird …). Nothing is sent until you press "Send" there.')))),
  actions: [
    { label: t('Cancel') },
    { label: t('Open e-mail draft'), primary: true, onClick: () => {
      (async () => {
        try {
          const pages = pg.get(); if (pages && !pages.length) { toast(t('Please enter pages, e.g. 1-3, 5.')); return; }
          const bytes = await exportBytes(picked(box, 'mhow'), pages);
          let name = fname.value.trim() || S.name; if (!/\.pdf$/i.test(name)) name += '.pdf';
          const r = await S.api.request({ type: 'mail', to: to.value.trim(), subject: subject.value, body: body.value, name, b64: toB64(bytes) });
          // Some mail programs (new Outlook with a Gmail account) open the draft but drop the attachment: the PDF lies ready next to it
          if (r.ok) toast(t('E-mail draft opened. Check it and press "Send" in your mail program.'), 12000, { label: t('Attachment missing? Show PDF'), onClick: () => S.api.post({ type: 'revealTemp', file: r.pdf || r.file }) });
          else mailFallback(r.pdf || r.file);
        } catch (e) { toast('Error: ' + (e.message || e), 6000); }
      })();
    } }] });
  setTimeout(() => to.focus(), 30);
}
function mailFallback(file) {
  modal({ title: t('No mail program found'), body: el('p', {}, t('Windows has no program for e-mail drafts (.eml). Use webmail instead: the folder with the prepared file opens, drag the PDF into your e-mail.')),
    actions: [{ label: t('Close') }, { label: t('Show file'), primary: true, onClick: () => S.api.post({ type: 'revealTemp', file }) }] });
}

// ------------------------------------------------------------ File menu
export function fileMenu(x, y) {
  S.api.showMenu(x, y, [
    ...(S.converted ? [{ l: t('Save as PDF …'), ic: 'save', f: saveAs }] : [
      { l: S.dirty ? t('Save (overwrite file)') : t('Save – no changes'), ic: 'save', d: !S.dirty, f: saveFile },
      { l: t('Save as …'), ic: 'file', f: saveAs }]),
    { l: t('Save a copy with annotations …'), ic: 'download', f: copyDialog },
    '-',
    { l: t('Print …'), ic: 'print', f: printDialog },
    { l: t('Send by e-mail …'), ic: 'mail', f: mailDialog },
    '-',
    { l: t('Show in folder'), ic: 'folder', f: () => S.api.post({ type: 'reveal' }) },
    { l: t('Copy file path'), ic: 'copy', f: async () => { await S.api.request({ type: 'copyPath' }); toast(t('Copied'), 1200); } }
  ]);
}

export function initShare() {
  $('#tFile').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); fileMenu(r.left, r.bottom + 4); };
  $('#tSave').onclick = copyDialog;
  $('#tPrint').onclick = printDialog;
  $('#tMail').onclick = mailDialog;
}
