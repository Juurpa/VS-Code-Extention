# Changelog

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
