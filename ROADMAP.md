# PDF Workbench – Roadmap

PDF Workbench keeps one promise: **the AI operates the tools, the human checks, approves and signs – and everything important runs locally.** This roadmap lists what is missing compared with Acrobat-class tools and other PDF extensions, ordered by value for effort. Items marked ✔ exist today.

## Where we stand

| Area | Today |
|---|---|
| Reading | ✔ viewer, highlights, comments, drawing, flashcards from highlights |
| Pages | ✔ rotate, delete, duplicate, reorder, extract, insert, merge, split, crop, page numbers, compress |
| Privacy | ✔ true redaction with independent verification, offline OCR (German + English) |
| AI | ✔ 15 MCP tools, free choice of AI (Claude Code, OpenAI-compatible, Ollama, clipboard) |
| Signing | ✔ simple image signature only (not legally equivalent to written form) |
| Missing | forms, watermark/stamp, metadata, tables, compare, convert, password protection, certificate signatures, images export/import |

Other VS Code PDF extensions are mostly read-only viewers. Acrobat-class tools add editing, forms, conversion, comparison and signing. The gap is largest for forms, conversion and signing.

## Tier 1 – next releases (small effort, high value, fully local)

1. **Form filling.** List form fields, fill them (by the AI or by hand), optionally flatten. Tools: `pdf_form_fields`, `pdf_fill_form`. Biggest everyday use case in offices and public authorities.
2. **Watermark, stamp, header/footer.** Text or image on selected pages ("DRAFT", "CONFIDENTIAL", dates, Bates numbers).
3. **Metadata viewer, editor and cleaner.** Show author, producer, hidden data; strip everything before sharing. Complements redaction.
4. **MCP: write highlights and comments** (today the AI can only read them).
5. **Table and structure extraction** to CSV / Markdown / JSON, with page references. Very common AI use case (invoices, reports).
6. **Export pages as PNG/JPG, extract embedded images, create a PDF from images.**
7. **Search across all PDFs in the workspace** (including OCR text), results with page and snippet.
8. **Compare two PDFs** (text diff per page, shown in the viewer and returned to the AI).
9. **Bookmarks / table of contents** viewer and editor.

## Tier 2 – bigger features

10. **Password protection** (AES-256) and decryption (needs an encryption engine such as qpdf compiled to WebAssembly; check license and size).
11. **AI-assisted redaction suggestions** (names, addresses, health data) – the AI proposes, the human confirms every bar, verification stays independent.
12. **Question answering and summaries with page citations**, optional fully local via Ollama.
13. **Translation** of a PDF into a new PDF or Markdown.
14. **Signature providers** (abstraction + first connector, for example Skribble) for legally valid signatures; the user creates the account, the human always approves and sends.
15. **Export to Markdown / Word** and import from Word/Markdown (start with Markdown, it is the cheap and AI-friendly format).
16. **Real text editing** in the page (hard: fonts and layout) – evaluate after forms and stamps.
17. **PDF/A and accessibility checks** for public-sector use.

## Tier 3 – product quality and release engineering

- Automated tests in CI (redaction regression suite, OCR smoke test, MCP smoke test, packaged-extension test in real VS Code), run on Windows, macOS and Linux.
- Bundle the extension (esbuild) for faster start and smaller package.
- Windows and macOS test passes: OCR, MCP start, paths with spaces and umlauts.
- Screenshots and demo GIF in the README; a short walkthrough on first start.
- Release pipeline: tag → build → publish to the VS Code Marketplace and Open VSX.
- Optional localisation (English default; German as a second language) once the English base is stable.
- Issue templates, CONTRIBUTING, security policy.

## Beyond PDF – separate extensions

Images, video and office files should not bloat this extension. Plan: when PDF Workbench is stable, split shared code (file handling, redaction principles, MCP server skeleton, AI provider layer) into a core package and ship focused extensions:

- **Werkbank Image** – crop, resize, annotate, blur/redact regions and faces, strip EXIF, OCR, background removal (local).
- **Werkbank Video** – trim, cut, subtitles, blur regions, export (needs ffmpeg; heavy, so a separate extension).
- **Werkbank Office** – read and light-edit docx/xlsx/pptx, convert to PDF.

Each follows the same rules: originals are never overwritten, results are new files, nothing is sent without approval, verification where privacy is at stake.

## Principles for every new feature

- Originals are never overwritten; results are new files.
- Anything that hides information must be verified independently.
- No document content in logs, reports or error messages.
- Local first; cloud features only with explicit approval.
- Every new dependency gets its license entry in `THIRD_PARTY_LICENSES.md` and `NOTICE`.
