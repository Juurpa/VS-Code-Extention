'use strict';
// Reine Hilfsfunktionen für Fehlerberichte und Feedback (ohne VS-Code-Abhängigkeit, damit testbar).

const TYPES = {
  bug: { label: 'Fehler', gh: 'bug', head: 'Fehlerbericht' },
  wish: { label: 'Wunsch / Idee', gh: 'enhancement', head: 'Wunsch' },
  praise: { label: 'Lob / Allgemeines', gh: 'feedback', head: 'Rückmeldung' }
};

/** Entfernt Pfade, Benutzernamen, E-Mail-Adressen und lange Zahlenfolgen aus Text. */
function scrub(text, { home = '', roots = [] } = {}) {
  let t = String(text == null ? '' : text);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = (p) => (p ? [p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')] : []);
  for (const r of roots.filter(Boolean).sort((a, b) => b.length - a.length)) for (const v of new Set(variants(r))) t = t.replace(new RegExp(esc(v), 'gi'), '<Projekt>');
  for (const v of new Set(variants(home))) if (v) t = t.replace(new RegExp(esc(v), 'gi'), '~');
  t = t.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s'"]+/gi, '$1<Benutzer>').replace(/(\/(?:home|Users)\/)[^/\s'"]+/g, '$1<Benutzer>');
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<E-Mail>');
  t = t.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '<IBAN>');
  t = t.replace(/\b\d[\d\s-]{11,}\d\b/g, '<Zahl>');
  return t;
}

/** Findet Stellen, die nach privaten Daten aussehen (nur Hinweis, blockiert nichts). */
function privacyHints(text) {
  let s = String(text || ''), out = [];
  if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(s)) out.push('E-Mail-Adresse');
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ');
  const ib = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
  if (ib.test(s)) out.push('IBAN');
  s = s.replace(ib, ' ');
  if (/\b\d{16}\b|\b(?:\d{4}[ -]){3}\d{4}\b/.test(s)) out.push('Kartennummer');
  else if (/(?:\+49|\b0)\s?\d{2,5}[\s/-]?\d{4,}/.test(s)) out.push('Telefonnummer');
  if (/(?:Steuer-?ID|Steuernummer|Versicherungsnummer|Personalausweis)/i.test(s)) out.push('Ausweis- oder Steuerangabe');
  return out;
}

const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + ' …' : s; };

/** Baut den Bericht als Markdown. diag: { items:[[Name,Wert]], errors:[{t,where,message}], pdf:{…}|null } */
function buildReport(form, diag, opt = {}) {
  const ty = TYPES[form.type] || TYPES.bug;
  const L = [];
  L.push(`## ${ty.head}`, '');
  if (form.what) L.push(form.type === 'bug' ? '**Was ist passiert?**' : '**Beschreibung**', clip(form.what, 4000), '');
  if (form.type === 'bug' && form.expected) L.push('**Was hatte ich erwartet?**', clip(form.expected, 2000), '');
  if (form.type === 'bug' && form.steps) L.push('**Schritte zum Nachstellen**', clip(form.steps, 3000), '');
  if (form.contact) L.push('**Rückfragen an:** ' + clip(form.contact, 200), '');
  if (form.withSystem && diag && diag.items && diag.items.length) {
    L.push('<details><summary>Systemdaten</summary>', '', ...diag.items.map(([k, v]) => `- ${k}: ${scrub(v, opt)}`), '', '</details>', '');
  }
  if (form.withErrors && diag && diag.errors && diag.errors.length) {
    L.push('<details><summary>Letzte Fehlermeldungen</summary>', '', '```', ...diag.errors.map((e) => `${e.t}  [${e.where}]  ${scrub(e.message, opt)}`), '```', '', '</details>', '');
  }
  if (form.withPdf && diag && diag.pdf) {
    const p = diag.pdf;
    L.push('<details><summary>Angaben zur geöffneten PDF (ohne Inhalt und Dateiname)</summary>', '', ...Object.entries(p).map(([k, v]) => `- ${k}: ${scrub(String(v), opt)}`), '', '</details>', '');
  }
  L.push('---', '_Erstellt mit Werkbank. Dieser Bericht enthält keine Dokumentinhalte._');
  return L.join('\n');
}

function titleOf(form) {
  const ty = TYPES[form.type] || TYPES.bug;
  return `[${ty.label}] ${clip(form.title || 'Ohne Titel', 100)}`;
}

/** GitHub-URL zum Vorbefüllen einer neuen Meldung. Gibt auch zurück, ob gekürzt wurde. */
function githubUrl(repo, form, body, max = 6500) {
  let base = String(repo || '').trim().replace(/\.git$/, '').replace(/\/+$/, '').replace(/\/issues.*$/, '');
  const m = base.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i);
  if (!m) return null;
  base = `https://github.com/${m[1]}/${m[2]}`;
  const ty = TYPES[form.type] || TYPES.bug;
  let b = body, cut = false;
  const mk = (x) => `${base}/issues/new?title=${encodeURIComponent(titleOf(form))}&labels=${encodeURIComponent(ty.gh)}&body=${encodeURIComponent(x)}`;
  let url = mk(b);
  while (url.length > max && b.length > 200) { b = b.slice(0, Math.floor(b.length * 0.8)); cut = true; url = mk(b + '\n\n_(gekürzt – vollständiger Bericht folgt im Kommentar)_'); }
  return { url, cut };
}

function mailtoUrl(email, form, body, max = 1800) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return null;
  let b = body, cut = false;
  const mk = (x) => `mailto:${email}?subject=${encodeURIComponent('Werkbank: ' + titleOf(form))}&body=${encodeURIComponent(x)}`;
  let url = mk(b);
  while (url.length > max && b.length > 200) { b = b.slice(0, Math.floor(b.length * 0.8)); cut = true; url = mk(b + '\n\n(gekürzt – vollständiger Bericht im Anhang)'); }
  return { url, cut };
}

module.exports = { TYPES, scrub, privacyHints, buildReport, titleOf, githubUrl, mailtoUrl };
