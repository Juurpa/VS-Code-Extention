'use strict';
// Pure functions: file names, Markdown files and prompts for Claude Code.
const COLOR_NAMES = { '#fff176': 'yellow', '#a5f3a0': 'green', '#8fd3ff': 'blue', '#ffadd2': 'pink' };

function toPosix(p) { return String(p).replace(/\\/g, '/'); }
function stripPdf(rel) { return toPosix(rel).replace(/\.pdf$/i, ''); }
function dataDirRel(dataFolder, relPdf) { return toPosix(dataFolder).replace(/\/+$/, '') + '/' + stripPdf(relPdf); }

function buildTextMd({ relPdf, texts }) {
  const out = [`# PDF text: ${toPosix(relPdf)}`, '', `Extracted automatically by PDF Workbench (${texts.length} pages). Do not edit by hand.`, ''];
  texts.forEach((t, i) => { out.push(`## Page ${i + 1}`, '', (t || '').trim() || '_(no text, possibly a scanned image)_', ''); });
  return out.join('\n');
}

function collectMarks(ann) {
  const pages = Object.keys(ann || {}).map(Number).sort((a, b) => a - b);
  const res = [];
  for (const n of pages) {
    const a = ann[n] || {};
    const hl = (a.hl || []).filter((h) => h.text && h.text !== '…').map((h) => ({ page: n, kind: 'hl', text: h.text, color: COLOR_NAMES[h.color] || 'highlighted' }));
    const notes = (a.notes || []).map((x) => ({ page: n, kind: 'note', text: x.text }));
    const ink = (a.ink || []).length;
    if (hl.length || notes.length || ink) res.push({ page: n, hl, notes, ink });
  }
  return res;
}

function buildMarksMd({ relPdf, ann }) {
  const marks = collectMarks(ann);
  const out = [`# My highlights: ${toPosix(relPdf)}`, '', 'Generated automatically by PDF Workbench. These passages are especially important to me.', ''];
  if (!marks.length) out.push('_No highlights yet._', '');
  for (const m of marks) {
    out.push(`## Page ${m.page}`, '');
    m.hl.forEach((h) => out.push(`- “${h.text}” (${h.color})`));
    m.notes.forEach((x) => out.push(`- Comment: ${x.text}`));
    if (m.ink) out.push(`- ${m.ink} handwritten drawing(s) on this page`);
    out.push('');
  }
  return out.join('\n');
}

function buildPrompt(kind, { relPdf, dataFolder, page, selection, count }) {
  const dir = dataDirRel(dataFolder, relPdf);
  const files = `You can find the extracted text in \`${dir}/text.md\` and my highlights and comments in \`${dir}/marks.md\`.`;
  const pdf = `\`${toPosix(relPdf)}\``;
  const cite = 'Cite sources with the page number, e.g. (p. 4). Answer in English.';
  switch (kind) {
    case 'summary-page': return `Summarize page ${page} of the PDF ${pdf} in bullet points for studying. ${files} ${cite}`;
    case 'summary-doc': return `Summarize the PDF ${pdf} in a structured way for studying. ${files} Give my highlights more weight. ${cite} Also save the result as \`${dir}/summary.md\`.`;
    case 'learn': return `Create a study sheet for the PDF ${pdf} with the sections Key Points, Important Terms (short definition) and Possible Exam Questions. ${files} Give my highlights more weight. ${cite} Save it as \`${dir}/study-notes.md\`.`;
    case 'quiz': return `Create ${count || 8} multiple-choice questions (4 answers each) about the PDF ${pdf} that match my highlights. ${files} Put the solutions with a short explanation and page number at the end and save everything as \`${dir}/quiz.md\`. Answer in English.`;
    case 'cards': return `Create ${count || 15} flashcards (front: question or term, back: answer) for the PDF ${pdf}. ${files} Focus mainly on my highlighted passages. Save them as \`${dir}/flashcards.md\` in the format "Q: … / A: …". Answer in English.`;
    case 'explain': return `Explain this passage from the PDF ${pdf}${page ? ` (page ${page})` : ''} clearly and with an example:\n\n“${String(selection || '').slice(0, 1200)}”\n\n${files} ${cite}`;
    case 'ask': return `I am working with the PDF ${pdf}. ${files} Answer my question based on these files. ${cite}\n\nQuestion: `;
    default: return '';
  }
}

const CLAUDE_MD_MARK = '<!-- werkbank -->';
function claudeMdSnippet(dataFolder) {
  const d = toPosix(dataFolder).replace(/\/+$/, '');
  return `${CLAUDE_MD_MARK}\n## PDFs and study material\nFor every PDF I open with PDF Workbench, the folder \`${d}/\` contains a subfolder with the same path. It contains:\n- \`text.md\`: the extracted text of the PDF, organized by page\n- \`marks.md\`: my highlights and comments (these are especially important to me)\n- \`quiz.md\`, \`study-notes.md\`, \`flashcards.md\`: study aids created by you\nFor questions about PDFs, read these files first instead of the PDF itself. Cite page numbers as sources.\n${CLAUDE_MD_MARK}\n`;
}

module.exports = { COLOR_NAMES, toPosix, stripPdf, dataDirRel, buildTextMd, collectMarks, buildMarksMd, buildPrompt, claudeMdSnippet, CLAUDE_MD_MARK };
