# Changelog

## 0.10.0
- **Open Word (.docx), PowerPoint (.pptx) and images (JPG, PNG, GIF, BMP, WebP).** The file is converted to a PDF locally in the viewer, so all tools work on it (highlight, search, redact, sign, OCR, AI). Word/PowerPoint pages get an exact invisible text layer from the layout positions; images are embedded losslessly, EXIF rotation of phone photos is applied.
- The original is never written: “Save” becomes **File → Save as PDF** (suggests `<name>.pdf` next to the original).
- .docx/.pptx open in PDF Workbench by default; images via the explorer context menu **Open in PDF Workbench** (VS Code's image preview stays the default).
- New components: docx-preview, @aiden0z/pptx-renderer (with ECharts, ZRender, mtx-decompressor), JSZip, html-to-image (licenses in `media/lib/office/` and `THIRD_PARTY_LICENSES.md`).

## 0.9.0
- **Edit text:** click a line in the PDF, rewrite it, press Enter. The old letters are deleted from the page code (redaction engine without a bar), the new line keeps bold/italic/color of unchanged parts and is fitted to the old width. Two checks: no old letter left, no other text lost. New AI tool `pdf_replace_text` (22 tools).
- **Add text** boxes and **insert images** (move, resize, burned in on saving).
- Highlights: **underline** and **strike through**; click a highlight for color, kind, note, copy, explain, delete.
- Drawing: **shapes** (line, arrow, rectangle, ellipse), highlighter pen, Shift for straight lines. Eraser: new icon, size slider, “clear this page”. Comments can be moved.
- **Sidebar tabs:** pages, **highlights list** (filter, jump to passage, export Markdown/CSV/JSON, AI: study sheet, mind map, summary, flashcards from highlights), **search** (Ctrl+F, all matches highlighted) and **table of contents**.
- **File menu:** save, save as, save a copy with annotations (choose place and name; burned in or as **real PDF comments** for Acrobat/Edge/Preview), **print**, **e-mail draft with the PDF attached**, show in folder, copy path.
- **Toolbar fully configurable:** drag buttons, right-click to remove, pin any tool, labels automatic/always/icons only, dialog “Customize toolbar”. Labels hide automatically when space is short.
- **Merge PDFs:** drop any number of files into the dialog (from the file manager, or from the VS Code explorer with Shift held). They are read one after another with a status per file, each row shows its place and its page range in the result, rows can be dragged into order, unreadable files are marked.
- Edit text: the size of the new text is now right in PDFs that keep the font size in the text matrix (LaTeX, Word); the preview uses the original font family and covers the whole old line.
- Dark pages, automatic reload when the file is changed outside (e.g. by the AI), unsaved changes shown on the File button.
- All new texts in German, French, Spanish, Italian, Dutch, Polish and Portuguese.

## 0.8.3
- New icon set (one grid, one line style) in the toolbar, menus and page sidebar.
- Quick bar: pin tools from the Tools menu, drag to reorder, right-click to unpin. Saved by the extension.
- Saved signatures: keep up to 12, pick one from the toolbar, delete saved ones. Right-click a placed signature to edit, duplicate, remove or replace it. Right-click a redaction area to duplicate or remove it.
- AI button: the prompt is now typed into Claude Code directly (you only press Enter); it is still copied as a backup.
- Seven interface languages: de, fr, es, it, nl, pl, pt (follows the VS Code language, English fallback).
- New AI tool `pdf_compare`: compares two PDFs by text (pages matched first, then words), returns the changes and writes a Markdown report.

## 0.8.2
- German interface (follows the VS Code language; English fallback): viewer, dialogs, messages, commands and settings.
- Signatures and redaction areas: small × button on hover and the Delete key; redaction areas can be moved and resized; the eraser hint mentions signatures.
- New "Insert page numbers" dialog: styles with examples, position grid, live preview on the real page, size and distance sliders, skip first page, selected pages only.
- Fixed the repository address so the README images resolve in the Marketplace page.
- Donation link (Buy Me a Coffee).

## 0.8.1
- Renamed from "Werkbank" to "PDF Workbench": commands and settings `pdfWorkbench.*`, data folder `_pdf-workbench`, variables `PDF_WORKBENCH_ROOT` / `PDF_WORKBENCH_DATA` (the old `WERKBANK_*` variables are still read by the MCP server).
- Windows fixes: a `.mcp.json` that points to an old extension folder is detected at startup and can be repaired with one click ("Connection closed" had no visible cause); clear message for a missing `file` argument; `pdf_info` groups equal page sizes; `pdf_read_text` no longer contains the control character U+0002 (hyphen); harmless pdf.js start-up warning no longer logged; OCR timing in the tool description corrected.
- Details: `docs/fehler-windows.md`.
## 0.8.0
- Complete English interface, messages, documentation and AI tool descriptions.
- New icon and branding.
- New AI tools: `pdf_form_fields`, `pdf_fill_form`, `pdf_flatten_form`, `pdf_watermark`, `pdf_metadata` (20 tools in total).
- Fixes: file names in merge/split/save dialogs, redaction options bar after applying, first thumbnail highlight, English labels.
- AI tools: English parameter and result names (`phone`, `date`, `note`, …) and output file suffixes (`_redacted`, `_extract`, `_compressed`, …).
- Data files renamed: `marks.md`, `summary.md`, `study-notes.md`, `flashcards.md`.

## 0.7.5
- State of the first public preparation: PDF reading/annotating, page tools, true redaction with verification, built-in OCR, MCP tools for the AI, bug reporting/feedback.
- User interface, MCP tool descriptions and documentation translated to English.
