// Test for mcp/compare.mjs with invented PDFs and known changes. Run: node test/compare/compare.test.mjs
import { PDFDocument, StandardFonts } from '../../media/lib/pdf-lib.esm.min.js';
import { comparePdfs, diffWords, changesOf, words, reportMarkdown } from '../../mcp/compare.mjs';

let fail = 0;
const ck = (n, ok, x = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fail++; };

async function pdf(pages) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) { const p = d.addPage([595, 842]); lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font: f })); }
  return new Uint8Array(await d.save());
}
const P1 = ['Gait analysis report', 'The knee angle was measured at 60 degrees.', 'Cadence 110 steps per minute.'];
const P2 = ['Method', 'Markers were placed on the hip, the knee and the ankle.', 'Each trial was filmed from the side.'];
const P3 = ['Appendix', 'Raw values are stored in the data folder.', 'Contact the group for access.'];
const NEW = ['Conclusion', 'The stance phase lasts about sixty percent of the cycle.', 'The swing phase lasts the rest.'];

// words and diff
ck('hyphenated line break is joined', words('Gang-\nanalyse ist').join(' ') === 'Ganganalyse ist');
const d = diffWords('a b c d'.split(' '), 'a x c d e'.split(' '));
ck('diffWords marks replace and add', d.filter((o) => o.t === '-').map((o) => o.w).join() === 'b' && d.filter((o) => o.t === '+').map((o) => o.w).join() === 'x,e');
ck('changesOf groups a replacement', changesOf(d).length === 2 && changesOf(d)[0].type === 'replace');

// identical documents
const A = await pdf([P1, P2, P3]);
let r = await comparePdfs(A, A);
ck('identical: all pages same', r.summary.same === 3 && r.summary.changed === 0 && r.summary.added === 0 && r.summary.removed === 0, JSON.stringify(r.summary));

// edited page, inserted page, removed page
const P2b = ['Method', 'Markers were placed on the hip, the knee, the ankle and the heel.', 'Each trial was filmed from the front.'];
const B = await pdf([P1, P2b, NEW]); // page 2 edited, page 3 replaced by a different page
r = await comparePdfs(A, B);
const st = r.pages.map((p) => `${p.a ?? '-'}>${p.b ?? '-'}:${p.status}`).join(' ');
ck('page 1 same, page 2 changed, old 3 removed, new 3 added', /^1>1:same 2>2:changed (3>-:removed ->3:added|->3:added 3>-:removed)$/.test(st), st);
const p2 = r.pages.find((p) => p.a === 2);
ck('page 2 has exactly the changed spots (3 word groups)', p2.changes.length === 3, JSON.stringify(p2.changes.map((c) => [c.type, c.old, c.new])));
ck('edit "side" -> "front" found', p2.changes.some((c) => c.type === 'replace' && c.old === 'side.' && c.new === 'front.'));
ck('edit adds "the heel"', p2.changes.some((c) => c.new.includes('heel')));

// inserted page in the middle does not shift the rest
const C = await pdf([P1, NEW, P2, P3]);
r = await comparePdfs(A, C);
ck('inserted middle page: others stay same', r.summary.same === 3 && r.summary.added === 1 && r.summary.changed === 0 && r.summary.removed === 0, JSON.stringify(r.summary));

// removed first page
const D = await pdf([P2, P3]);
r = await comparePdfs(A, D);
ck('removed first page', r.summary.removed === 1 && r.summary.same === 2, JSON.stringify(r.summary));

// scan without text
const E = await pdf([[], P2]);
r = await comparePdfs(E, E);
ck('page without text is reported', r.summary.noText === 1 && r.summary.notes.length === 1, JSON.stringify(r.summary));

const md = reportMarkdown(await comparePdfs(A, B), 'a.pdf', 'b.pdf');
ck('report names the edit', md.includes('~~side.~~ **front.**') && md.includes('## Old page 2 → new page 2: changed'), md.split('\n').slice(0, 8).join(' | '));
console.log(fail ? '\nFAILED ' + fail : '\nALL PASSED'); process.exit(fail ? 1 : 0);
