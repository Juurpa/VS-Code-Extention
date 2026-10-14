// Compare two PDFs by text: pages are matched first (inserted or removed pages do not shift the rest),
// then the words of matched pages are compared. Pure functions, no dependencies, nothing is written here.
import { readText } from './ops.mjs';

const MAX_CELLS = 16e6; // above this a page pair is reported as "heavily changed" instead of word by word

/** Splits text into words; a hyphen at a line end is joined ("Gang-\nanalyse" -> "Ganganalyse"). */
export function words(text) {
  return String(text || '').replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2').split(/\s+/).filter(Boolean);
}

/** Word-level diff of two word lists. Returns ops: { t: '=' | '-' | '+', w: word } in order. */
export function diffWords(a, b) {
  let s = 0; const ea = a.length, eb = b.length;
  while (s < ea && s < eb && a[s] === b[s]) s++;
  let ta = ea, tb = eb;
  while (ta > s && tb > s && a[ta - 1] === b[tb - 1]) { ta--; tb--; }
  const head = a.slice(0, s).map((w) => ({ t: '=', w })), tail = a.slice(ta).map((w) => ({ t: '=', w }));
  const A = a.slice(s, ta), B = b.slice(s, tb), n = A.length, m = B.length;
  if (!n || !m) return [...head, ...A.map((w) => ({ t: '-', w })), ...B.map((w) => ({ t: '+', w })), ...tail];
  if (n * m > MAX_CELLS) return null;
  // LCS table (Uint16 is enough per page: up to 65535 words in the changed middle part)
  const W = m + 1, L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const mid = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { mid.push({ t: '=', w: A[i] }); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) mid.push({ t: '-', w: A[i++] });
    else mid.push({ t: '+', w: B[j++] });
  }
  while (i < n) mid.push({ t: '-', w: A[i++] });
  while (j < m) mid.push({ t: '+', w: B[j++] });
  return [...head, ...mid, ...tail];
}

/** Groups diff ops into readable changes with a little context. */
export function changesOf(ops, ctx = 6) {
  const out = []; let k = 0;
  while (k < ops.length) {
    if (ops[k].t === '=') { k++; continue; }
    let e = k; const del = [], ins = [];
    while (e < ops.length && ops[e].t !== '=') { (ops[e].t === '-' ? del : ins).push(ops[e].w); e++; }
    const before = []; for (let x = k - 1; x >= 0 && before.length < ctx && ops[x].t === '='; x--) before.unshift(ops[x].w);
    const after = []; for (let x = e; x < ops.length && after.length < ctx && ops[x].t === '='; x++) after.push(ops[x].w);
    out.push({ type: del.length && ins.length ? 'replace' : del.length ? 'removed' : 'added', old: del.join(' '), new: ins.join(' '), before: before.join(' '), after: after.join(' ') });
    k = e;
  }
  return out;
}

// Page similarity: share of common words (multiset), 0..1
function bag(ws) { const m = new Map(); for (const w of ws) m.set(w, (m.get(w) || 0) + 1); return m; }
function similarity(ba, bb, na, nb) {
  if (!na && !nb) return 1; if (!na || !nb) return 0;
  let common = 0; for (const [w, c] of ba) { const d = bb.get(w); if (d) common += Math.min(c, d); }
  return (2 * common) / (na + nb);
}

/** Matches the pages of A to the pages of B (order preserving). Returns [{ a: index|null, b: index|null }]. */
export function alignPages(pa, pb, minSim = 0.35) {
  const n = pa.length, m = pb.length, ba = pa.map(bag), bb = pb.map(bag);
  const sim = (i, j) => similarity(ba[i], bb[j], pa[i].length, pb[j].length);
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)), D = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) D[i][0] = 1; for (let j = 1; j <= m; j++) D[0][j] = 2;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = sim(i - 1, j - 1), diag = s >= minSim ? S[i - 1][j - 1] + s : -Infinity, up = S[i - 1][j], left = S[i][j - 1];
    if (diag >= up && diag >= left && diag > -Infinity) { S[i][j] = diag; D[i][j] = 0; } else if (up >= left) { S[i][j] = up; D[i][j] = 1; } else { S[i][j] = left; D[i][j] = 2; }
  }
  const out = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    const d = i === 0 ? 2 : j === 0 ? 1 : D[i][j];
    if (d === 0) { out.push({ a: i - 1, b: j - 1 }); i--; j--; } else if (d === 1) { out.push({ a: i - 1, b: null }); i--; } else { out.push({ a: null, b: j - 1 }); j--; }
  }
  return out.reverse();
}

/** Compares two PDFs (bytes). Result: { summary, pages: [...] }, every page entry has its changes. */
export async function comparePdfs(bytesA, bytesB, opts = {}) {
  const [ta, tb] = await Promise.all([readText(bytesA), readText(bytesB)]);
  const pa = ta.map((p) => words(p.text)), pb = tb.map((p) => words(p.text));
  const pairs = alignPages(pa, pb), pages = [];
  const sum = { pagesA: pa.length, pagesB: pb.length, same: 0, changed: 0, added: 0, removed: 0, wordsAdded: 0, wordsRemoved: 0, noText: 0, notes: [] };
  for (const { a, b } of pairs) {
    if (a === null) { pages.push({ a: null, b: b + 1, status: 'added', wordsNew: pb[b].length, changes: [] }); sum.added++; sum.wordsAdded += pb[b].length; continue; }
    if (b === null) { pages.push({ a: a + 1, b: null, status: 'removed', wordsOld: pa[a].length, changes: [] }); sum.removed++; sum.wordsRemoved += pa[a].length; continue; }
    const noText = !pa[a].length && !pb[b].length;
    if (noText) { pages.push({ a: a + 1, b: b + 1, status: 'notext', changes: [] }); sum.noText++; continue; }
    const ops = diffWords(pa[a], pb[b]);
    if (!ops) { pages.push({ a: a + 1, b: b + 1, status: 'changed', heavy: true, wordsOld: pa[a].length, wordsNew: pb[b].length, changes: [] }); sum.changed++; sum.wordsRemoved += pa[a].length; sum.wordsAdded += pb[b].length; continue; }
    const changes = changesOf(ops, opts.context ?? 6), rem = ops.filter((o) => o.t === '-').length, add = ops.filter((o) => o.t === '+').length;
    sum.wordsAdded += add; sum.wordsRemoved += rem;
    if (!changes.length) { pages.push({ a: a + 1, b: b + 1, status: 'same', changes: [] }); sum.same++; } else { pages.push({ a: a + 1, b: b + 1, status: 'changed', wordsAdded: add, wordsRemoved: rem, changes }); sum.changed++; }
  }
  const scanned = (x) => x.filter((w) => !w.length).length;
  if (scanned(pa) || scanned(pb)) sum.notes.push('Pages without text (scans) cannot be compared by text. Run pdf_ocr on them first.');
  return { summary: sum, pages };
}

const pg = (n) => (n === null ? '–' : String(n));
/** Markdown report of a comparison result. */
export function reportMarkdown(res, nameA, nameB) {
  const s = res.summary, L = [];
  L.push(`# PDF comparison`, '', `- Old: \`${nameA}\` (${s.pagesA} pages)`, `- New: \`${nameB}\` (${s.pagesB} pages)`, '',
    `**Result:** ${s.changed} changed, ${s.same} unchanged, ${s.added} added, ${s.removed} removed page(s). Words: +${s.wordsAdded}, −${s.wordsRemoved}.`, '');
  for (const n of s.notes) L.push(`> ${n}`, '');
  const rel = res.pages.filter((p) => p.status !== 'same' && p.status !== 'notext');
  if (!rel.length) L.push('No differences in the text.');
  for (const p of rel) {
    L.push(`## Old page ${pg(p.a)} → new page ${pg(p.b)}: ${p.status}`, '');
    if (p.status === 'added') L.push(`New page with ${p.wordsNew} words.`, '');
    else if (p.status === 'removed') L.push(`Page removed (${p.wordsOld} words).`, '');
    else if (p.heavy) L.push(`Page changed heavily (${p.wordsOld} → ${p.wordsNew} words); not compared word by word.`, '');
    else for (const c of p.changes) {
      const ctx = (c.before ? '…' + c.before + ' ' : '');
      L.push(`- ${ctx}${c.old ? '~~' + c.old + '~~ ' : ''}${c.new ? '**' + c.new + '**' : ''}${c.after ? ' ' + c.after + '…' : ''}`);
    }
    L.push('');
  }
  return L.join('\n');
}
