// Dialog „Texterkennung (OCR)“. Die Erkennung selbst läuft in der Erweiterung (lokal, ohne Internet).
import { S, el, toast, modal } from './util.js';
import { commit, toB64, b64ToBytes } from './pages.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);

export async function ocrDialog() {
  toast('Seiten werden geprüft …', 1500);
  const scan = await S.api.request({ type: 'ocrScan', b64: toB64(S.bytes) });
  if (!scan.ok) throw new Error(scan.error || 'Prüfung fehlgeschlagen.');
  const noText = scan.pages.filter((p) => p.scanned).map((p) => p.page), total = scan.pages.length;

  const which = el('select', {},
    el('option', { value: 'scan' }, noText.length ? `Seiten ohne Text (${noText.length} von ${total})` : 'Seiten ohne Text (keine vorhanden)'),
    el('option', { value: 'all' }, 'Alle Seiten'),
    el('option', { value: 'cur' }, 'Nur diese Seite (' + S.cur + ')'));
  which.value = noText.length ? 'scan' : 'cur';
  const lang = el('select', {}, el('option', { value: 'deu,eng' }, 'Deutsch und Englisch'), el('option', { value: 'deu' }, 'Nur Deutsch'), el('option', { value: 'eng' }, 'Nur Englisch'));
  const qual = el('select', {}, el('option', { value: 'good' }, 'Gut – genauer, erkennt auch Tabellen (ca. 10–25 s je Seite)'), el('option', { value: 'fast' }, 'Schnell – für saubere Scans (ca. halb so lang)'));
  const note = el('p', { class: 'muted' }, noText.length
    ? 'Das Bild bleibt unverändert. Der erkannte Text liegt unsichtbar dahinter: danach lässt sich suchen, markieren, kopieren und gezielt schwärzen. Alles läuft auf deinem Rechner, nichts wird hochgeladen.'
    : 'Alle Seiten haben schon Text. Du kannst trotzdem einzelne Seiten erkennen lassen, dort wird Text nur ergänzt.');
  const bar = el('progress', { max: '1', value: '0', style: 'width:100%' }), status = el('div', { class: 'muted' }, '');
  const prog = el('div', { class: 'stack', hidden: true }, bar, status);
  const form = el('div', { class: 'stack' }, note, field('Welche Seiten', which), field('Sprache', lang), field('Qualität', qual));

  let running = null;
  const m = modal({
    title: 'Texterkennung (OCR)', body: el('div', {}, form, prog),
    actions: [{ label: 'Schließen', onClick: () => { if (running) { S.api.post({ type: 'ocrCancel', rid: running.rid }); } } },
      { label: 'Starten', primary: true, close: false, onClick: (api) => { start(api); return false; } }]
  });
  const startBtn = m.bar.querySelector('.primary');

  async function start(api) {
    const pages = which.value === 'scan' ? noText : which.value === 'cur' ? [S.cur] : null;
    if (which.value === 'scan' && !noText.length) { toast('Keine Seite ohne Text gefunden.', 3500); return; }
    startBtn.disabled = true; form.hidden = true; prog.hidden = false; status.textContent = 'Texterkennung wird gestartet …';
    const n = pages ? pages.length : total;
    const pr = S.api.request({ type: 'ocr', b64: toB64(S.bytes), pages, langs: lang.value.split(','), fast: qual.value === 'fast', force: which.value !== 'scan' }, (p) => {
      bar.value = p.done / p.total; status.textContent = `Seite ${p.page} fertig (${p.done} von ${p.total}) …`;
    });
    running = pr; bar.max = '1'; status.textContent = `Erste Seite von ${n} wird erkannt …`;
    const r = await pr; running = null;
    if (!r.ok) { api.close(); toast(r.error === 'Abgebrochen.' ? 'Texterkennung abgebrochen, nichts geändert.' : 'Fehler: ' + r.error, 6000); return; }
    api.close();
    if (!r.b64) { toast(r.message || 'Keine Seite brauchte Texterkennung.', 5000); return; }
    await commit(b64ToBytes(r.b64), S.ann || {});
    const words = r.pages.reduce((a, p) => a + p.words, 0), low = r.pages.filter((p) => p.lowConf).map((p) => p.page), turned = r.pages.filter((p) => p.turned).map((p) => p.page);
    toast(`Text erkannt auf ${r.pages.length} ${r.pages.length === 1 ? 'Seite' : 'Seiten'} (${words} Wörter).` + (turned.length ? ` Gedreht eingescannt: Seite ${turned.join(', ')}.` : '') + (low.length ? ` Unsichere Erkennung auf Seite ${low.join(', ')}: bitte prüfen.` : ''), 10000);
  }
}
