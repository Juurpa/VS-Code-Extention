// Checks every language against German (the reference): same keys, same {placeholders}, no empty texts.
// Usage: node test/tools/i18n-check.mjs [lang ...]   (default: all languages found next to de.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL ' + m); };

const dictFiles = fs.readdirSync(path.join(root, 'media', 'i18n')).filter((f) => /^[a-z]{2}\.js$/.test(f)).map((f) => f.slice(0, 2));
const langs = process.argv.length > 2 ? process.argv.slice(2) : dictFiles.filter((l) => l !== 'de');
const ref = (await import(pathToFileURL(path.join(root, 'media', 'i18n', 'de.js')).href)).default;
const refBundle = read('l10n/bundle.l10n.de.json'), refNls = read('package.nls.de.json');

const compare = (name, a, b) => {
  for (const k of Object.keys(a)) {
    if (!(k in b)) { fail(`${name}: missing "${k.slice(0, 70)}"`); continue; }
    if (!String(b[k]).trim()) fail(`${name}: empty "${k.slice(0, 70)}"`);
    else if (ph(k) !== ph(b[k])) fail(`${name}: placeholders differ in "${k.slice(0, 60)}" -> "${String(b[k]).slice(0, 60)}"`);
  }
  for (const k of Object.keys(b)) if (!(k in a)) fail(`${name}: extra key "${k.slice(0, 70)}"`);
};
const compareNls = (name, a, b) => {
  for (const k of Object.keys(a)) {
    if (!(k in b)) fail(`${name}: missing ${k}`); else if (!String(b[k]).trim()) fail(`${name}: empty ${k}`);
  }
  for (const k of Object.keys(b)) if (!(k in a)) fail(`${name}: extra ${k}`);
};
const posCount = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join(',');

for (const l of langs) {
  console.log('== ' + l);
  const before = bad;
  const dict = (await import(pathToFileURL(path.join(root, 'media', 'i18n', l + '.js')).href)).default;
  compare('viewer ' + l, ref, dict);
  const bundleFile = ['l10n/bundle.l10n.' + l + '.json'];
  for (const bf of bundleFile) {
    if (!fs.existsSync(path.join(root, bf))) { fail('missing ' + bf); continue; }
    const b = read(bf);
    for (const k of Object.keys(refBundle)) {
      if (!(k in b)) fail(`bundle ${l}: missing "${k.slice(0, 70)}"`);
      else if (!String(b[k]).trim()) fail(`bundle ${l}: empty "${k.slice(0, 70)}"`);
      else if (posCount(k) !== posCount(b[k])) fail(`bundle ${l}: {0} placeholders differ in "${k.slice(0, 60)}"`);
    }
    for (const k of Object.keys(b)) if (!(k in refBundle)) fail(`bundle ${l}: extra key "${k.slice(0, 70)}"`);
  }
  const nlsFile = 'package.nls.' + l + '.json';
  if (!fs.existsSync(path.join(root, nlsFile))) fail('missing ' + nlsFile); else compareNls('nls ' + l, refNls, read(nlsFile));
  console.log(bad === before ? '  OK' : '  ' + (bad - before) + ' problem(s)');
}
console.log(bad ? '\nFAILED: ' + bad + ' problem(s)' : '\nALL LANGUAGES CONSISTENT');
process.exit(bad ? 1 : 0);
