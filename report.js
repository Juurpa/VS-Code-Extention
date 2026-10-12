'use strict';
// Pure helper functions for problem reports and feedback (no VS Code dependency, so they are testable).

const TYPES = {
  bug: { label: 'Bug', gh: 'bug', head: 'Bug report' },
  wish: { label: 'Request / Idea', gh: 'enhancement', head: 'Request' },
  praise: { label: 'Praise / General', gh: 'feedback', head: 'Feedback' }
};

/** Removes paths, user names, email addresses and long digit sequences from text. */
function scrub(text, { home = '', roots = [] } = {}) {
  let t = String(text == null ? '' : text);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = (p) => (p ? [p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')] : []);
  for (const r of roots.filter(Boolean).sort((a, b) => b.length - a.length)) for (const v of new Set(variants(r))) t = t.replace(new RegExp(esc(v), 'gi'), '<project>');
  for (const v of new Set(variants(home))) if (v) t = t.replace(new RegExp(esc(v), 'gi'), '~');
  t = t.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s'"]+/gi, '$1<user>').replace(/(\/(?:home|Users)\/)[^/\s'"]+/g, '$1<user>');
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
  t = t.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '<IBAN>');
  t = t.replace(/\b\d[\d\s-]{11,}\d\b/g, '<number>');
  return t;
}

/** Finds passages that look like private data (hint only, blocks nothing). */
function privacyHints(text) {
  let s = String(text || ''), out = [];
  if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(s)) out.push('email address');
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ');
  const ib = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
  if (ib.test(s)) out.push('IBAN');
  s = s.replace(ib, ' ');
  if (/\b\d{16}\b|\b(?:\d{4}[ -]){3}\d{4}\b/.test(s)) out.push('card number');
  else if (/(?:\+49|\b0)\s?\d{2,5}[\s/-]?\d{4,}/.test(s)) out.push('phone number');
  if (/(?:Steuer-?ID|Steuernummer|Versicherungsnummer|Personalausweis)/i.test(s)) out.push('ID or tax details');
  return out;
}

const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + ' …' : s; };

/** Builds the report as Markdown. diag: { items:[[Name,Wert]], errors:[{t,where,message}], pdf:{…}|null } */
function buildReport(form, diag, opt = {}) {
  const ty = TYPES[form.type] || TYPES.bug;
  const L = [];
  L.push(`## ${ty.head}`, '');
  if (form.what) L.push(form.type === 'bug' ? '**What happened?**' : '**Description**', clip(form.what, 4000), '');
  if (form.type === 'bug' && form.expected) L.push('**What did I expect?**', clip(form.expected, 2000), '');
  if (form.type === 'bug' && form.steps) L.push('**Steps to reproduce**', clip(form.steps, 3000), '');
  if (form.contact) L.push('**Contact for questions:** ' + clip(form.contact, 200), '');
  if (form.withSystem && diag && diag.items && diag.items.length) {
    L.push('<details><summary>System data</summary>', '', ...diag.items.map(([k, v]) => `- ${k}: ${scrub(v, opt)}`), '', '</details>', '');
  }
  if (form.withErrors && diag && diag.errors && diag.errors.length) {
    L.push('<details><summary>Recent error messages</summary>', '', '```', ...diag.errors.map((e) => `${e.t}  [${e.where}]  ${scrub(e.message, opt)}`), '```', '', '</details>', '');
  }
  if (form.withPdf && diag && diag.pdf) {
    const p = diag.pdf;
    L.push('<details><summary>Details about the open PDF (no content, no file name)</summary>', '', ...Object.entries(p).map(([k, v]) => `- ${k}: ${scrub(String(v), opt)}`), '', '</details>', '');
  }
  L.push('---', '_Created with Werkbank. This report contains no document content._');
  return L.join('\n');
}

function titleOf(form) {
  const ty = TYPES[form.type] || TYPES.bug;
  return `[${ty.label}] ${clip(form.title || 'Untitled', 100)}`;
}

/** GitHub URL for pre-filling a new issue. Also returns whether it was truncated. */
function githubUrl(repo, form, body, max = 6500) {
  let base = String(repo || '').trim().replace(/\.git$/, '').replace(/\/+$/, '').replace(/\/issues.*$/, '');
  const m = base.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i);
  if (!m) return null;
  base = `https://github.com/${m[1]}/${m[2]}`;
  const ty = TYPES[form.type] || TYPES.bug;
  let b = body, cut = false;
  const mk = (x) => `${base}/issues/new?title=${encodeURIComponent(titleOf(form))}&labels=${encodeURIComponent(ty.gh)}&body=${encodeURIComponent(x)}`;
  let url = mk(b);
  while (url.length > max && b.length > 200) { b = b.slice(0, Math.floor(b.length * 0.8)); cut = true; url = mk(b + '\n\n_(truncated – full report follows in a comment)_'); }
  return { url, cut };
}

function mailtoUrl(email, form, body, max = 1800) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return null;
  let b = body, cut = false;
  const mk = (x) => `mailto:${email}?subject=${encodeURIComponent('Werkbank: ' + titleOf(form))}&body=${encodeURIComponent(x)}`;
  let url = mk(b);
  while (url.length > max && b.length > 200) { b = b.slice(0, Math.floor(b.length * 0.8)); cut = true; url = mk(b + '\n\n(truncated – full report attached)'); }
  return { url, cut };
}

module.exports = { TYPES, scrub, privacyHints, buildReport, titleOf, githubUrl, mailtoUrl };
