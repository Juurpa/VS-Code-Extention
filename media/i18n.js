// Translations: English text is the key, a missing entry falls back to English.
// Dictionaries live in media/i18n/<language>.js (default export: { 'English text': 'translation' }).
let dict = {};
export let LANG = 'en';

export async function loadLang(code) {
  LANG = String(code || 'en').toLowerCase().split(/[-_]/)[0];
  dict = {};
  if (LANG === 'en') return;
  try { dict = (await import('./i18n/' + LANG + '.js')).default || {}; } catch (e) { dict = {}; }
  document.documentElement.lang = LANG;
}

/** t('Redacted on {n} pages', { n: 3 }) – {name} placeholders are filled from vars. */
export function t(s, vars) {
  let r = dict[s] ?? s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return r;
}

/** Translates the static HTML of the viewer (title, aria-label, placeholder and .lbl texts). */
export function applyI18n(root = document) {
  if (LANG === 'en') return;
  root.querySelectorAll('[title],[aria-label],[placeholder]').forEach((e) => {
    for (const a of ['title', 'aria-label', 'placeholder']) if (e.hasAttribute(a)) e.setAttribute(a, t(e.getAttribute(a)));
  });
  root.querySelectorAll('.lbl,[data-t]').forEach((e) => { if (e.children.length === 0) e.textContent = t(e.textContent.trim()); });
}
