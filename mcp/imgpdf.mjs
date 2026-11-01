// PDF from page images (Word/PowerPoint pages drawn in the viewer) with an invisible text layer exactly over the words.
// The word boxes come from the browser layout, so no text recognition is needed and the text is exact.
import fs from 'node:fs';
import { PDFDocument, PDFOperator, PDFArray, beginText, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, TextRenderingMode } from '../media/lib/pdf-lib.esm.min.js';
import fontkit from '@pdf-lib/fontkit';
import { FONT_FILE } from './textlayer.mjs';

const PT = 0.75; // pt per CSS pixel

/** Words in reading order → lines (same baseline band), so a space goes between words but not at a line end. */
function linesOf(words) {
  const lines = [];
  for (const w of words) {
    const cur = lines[lines.length - 1], last = cur && cur[cur.length - 1];
    const h = Math.min(w.y1 - w.y0, last ? last.y1 - last.y0 : Infinity);
    if (last && Math.abs((w.y0 + w.y1) / 2 - (last.y0 + last.y1) / 2) < 0.5 * h && w.x0 > last.x0) cur.push(w); else lines.push([w]);
  }
  return lines;
}

function writeWords(out, page, font, words, k, H) {
  const set = new Set(font.getCharacterSet());
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let written = 0;
  for (const line of linesOf(words)) {
    line.forEach((w, i) => {
      const txt = [...String(w.t)].filter((c) => set.has(c.codePointAt(0))).join('');
      if (!txt) return;
      // font size from the CSS font size; baseline ≈ 79 % down the glyph box (ascent : descent of common fonts)
      const size = Math.max(1, (w.s || (w.y1 - w.y0) / 1.15) * k);
      const base = H - (w.y0 + 0.79 * (w.y1 - w.y0)) * k;
      const natural = font.widthOfTextAtSize(txt, size), want = (w.x1 - w.x0) * k;
      const kx = Math.max(0.25, Math.min(4, want / Math.max(0.01, natural)));
      const arr = PDFArray.withContext(out.context);
      arr.push(font.encodeText(i === line.length - 1 ? txt : txt + ' '));
      ops.push(setFontAndSize(key, size), setTextMatrix(kx, 0, 0, 1, w.x0 * k, base), PDFOperator.of('TJ', [arr]));
      written++;
    });
  }
  ops.push(endText());
  page.pushOperators(...ops);
  return written;
}

/**
 * pages: [{ img: Uint8Array (JPEG or PNG), fmt: 'jpg'|'png', pxW, pxH (CSS px), words: [{ t, x0, y0, x1, y1, s }] }]
 * Coordinates of the words are CSS px from the top left of the page. Returns the PDF bytes.
 */
export async function pagesToPdf(pages, { title } = {}) {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  let font = null;
  for (const p of pages) {
    const W = p.pxW * PT, H = p.pxH * PT, page = out.addPage([W, H]);
    const img = p.fmt === 'png' ? await out.embedPng(p.img) : await out.embedJpg(p.img);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    if (Array.isArray(p.words) && p.words.length) {
      font ||= await out.embedFont(fs.readFileSync(FONT_FILE), { subset: true });
      writeWords(out, page, font, p.words, PT, H);
    }
  }
  if (title) out.setTitle(String(title));
  out.setProducer('PDF Workbench');
  return out.save();
}
