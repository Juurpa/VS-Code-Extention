# Changelog

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
