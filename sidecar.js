'use strict';
// Reine Funktionen: Dateinamen, Markdown-Dateien und Prompts für Claude Code.
const COLOR_NAMES = { '#fff176': 'gelb', '#a5f3a0': 'grün', '#8fd3ff': 'blau', '#ffadd2': 'rosa' };

function toPosix(p) { return String(p).replace(/\\/g, '/'); }
function stripPdf(rel) { return toPosix(rel).replace(/\.pdf$/i, ''); }
function dataDirRel(dataFolder, relPdf) { return toPosix(dataFolder).replace(/\/+$/, '') + '/' + stripPdf(relPdf); }

function buildTextMd({ relPdf, texts }) {
  const out = [`# Text der PDF: ${toPosix(relPdf)}`, '', `Automatisch extrahiert vom Werkbank (${texts.length} Seiten). Nicht von Hand bearbeiten.`, ''];
  texts.forEach((t, i) => { out.push(`## Seite ${i + 1}`, '', (t || '').trim() || '_(kein Text, evtl. eingescanntes Bild)_', ''); });
  return out.join('\n');
}

function collectMarks(ann) {
  const pages = Object.keys(ann || {}).map(Number).sort((a, b) => a - b);
  const res = [];
  for (const n of pages) {
    const a = ann[n] || {};
    const hl = (a.hl || []).filter((h) => h.text && h.text !== '…').map((h) => ({ page: n, kind: 'hl', text: h.text, color: COLOR_NAMES[h.color] || 'markiert' }));
    const notes = (a.notes || []).map((x) => ({ page: n, kind: 'note', text: x.text }));
    const ink = (a.ink || []).length;
    if (hl.length || notes.length || ink) res.push({ page: n, hl, notes, ink });
  }
  return res;
}

function buildMarksMd({ relPdf, ann }) {
  const marks = collectMarks(ann);
  const out = [`# Meine Markierungen: ${toPosix(relPdf)}`, '', 'Automatisch von der Werkbank erzeugt. Diese Stellen sind mir besonders wichtig.', ''];
  if (!marks.length) out.push('_Noch keine Markierungen._', '');
  for (const m of marks) {
    out.push(`## Seite ${m.page}`, '');
    m.hl.forEach((h) => out.push(`- „${h.text}“ (${h.color})`));
    m.notes.forEach((x) => out.push(`- Kommentar: ${x.text}`));
    if (m.ink) out.push(`- ${m.ink} handschriftliche Zeichnung(en) auf dieser Seite`);
    out.push('');
  }
  return out.join('\n');
}

function buildPrompt(kind, { relPdf, dataFolder, page, selection, count }) {
  const dir = dataDirRel(dataFolder, relPdf);
  const files = `Den extrahierten Text findest du in \`${dir}/text.md\`, meine Markierungen und Kommentare in \`${dir}/markierungen.md\`.`;
  const pdf = `\`${toPosix(relPdf)}\``;
  const cite = 'Nenne Fundstellen mit Seitenzahl, z. B. (S. 4). Antworte auf Deutsch.';
  switch (kind) {
    case 'summary-page': return `Fasse Seite ${page} der PDF ${pdf} für das Lernen in Stichpunkten zusammen. ${files} ${cite}`;
    case 'summary-doc': return `Fasse die PDF ${pdf} für das Lernen strukturiert zusammen. ${files} Gewichte meine Markierungen stärker. ${cite} Speichere das Ergebnis zusätzlich als \`${dir}/zusammenfassung.md\`.`;
    case 'learn': return `Erstelle einen Lernzettel zur PDF ${pdf} mit den Abschnitten Kernaussagen, Wichtige Begriffe (Kurzdefinition) und mögliche Prüfungsfragen. ${files} Gewichte meine Markierungen stärker. ${cite} Speichere ihn als \`${dir}/lernzettel.md\`.`;
    case 'quiz': return `Erstelle ${count || 8} Multiple-Choice-Fragen (je 4 Antworten) zur PDF ${pdf}, die zu meinen Markierungen passen. ${files} Schreibe die Lösungen mit kurzer Erklärung und Seitenzahl ans Ende und speichere alles als \`${dir}/quiz.md\`. Antworte auf Deutsch.`;
    case 'cards': return `Erstelle ${count || 15} Karteikarten (Vorderseite: Frage oder Begriff, Rückseite: Antwort) zur PDF ${pdf}. ${files} Nimm vor allem meine markierten Stellen. Speichere sie als \`${dir}/karteikarten.md\` im Format "Q: … / A: …". Antworte auf Deutsch.`;
    case 'explain': return `Erkläre mir diese Stelle aus der PDF ${pdf}${page ? ` (Seite ${page})` : ''} verständlich und mit Beispiel:\n\n„${String(selection || '').slice(0, 1200)}“\n\n${files} ${cite}`;
    case 'ask': return `Ich arbeite mit der PDF ${pdf}. ${files} Beantworte meine Frage anhand dieser Dateien. ${cite}\n\nFrage: `;
    default: return '';
  }
}

const CLAUDE_MD_MARK = '<!-- werkbank -->';
function claudeMdSnippet(dataFolder) {
  const d = toPosix(dataFolder).replace(/\/+$/, '');
  return `${CLAUDE_MD_MARK}\n## PDFs und Lernmaterial\nZu jeder PDF, die ich mit der Werkbank öffne, liegt im Ordner \`${d}/\` ein Unterordner mit gleichem Pfad. Darin:\n- \`text.md\`: der extrahierte Text der PDF, nach Seiten gegliedert\n- \`markierungen.md\`: meine Markierungen und Kommentare (das ist mir besonders wichtig)\n- \`quiz.md\`, \`lernzettel.md\`, \`karteikarten.md\`: von dir erstellte Lernhilfen\nLies bei Fragen zu PDFs zuerst diese Dateien statt die PDF selbst. Nenne Seitenzahlen als Fundstelle.\n${CLAUDE_MD_MARK}\n`;
}

module.exports = { COLOR_NAMES, toPosix, stripPdf, dataDirRel, buildTextMd, collectMarks, buildMarksMd, buildPrompt, claudeMdSnippet, CLAUDE_MD_MARK };
