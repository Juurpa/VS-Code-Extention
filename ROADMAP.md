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

1. ✔ **Form filling** (AI tools; UI still to do). List form fields, fill them (by the AI or by hand), optionally flatten. Tools: `pdf_form_fields`, `pdf_fill_form`. Biggest everyday use case in offices and public authorities.
2. ✔ **Watermark and stamp** (AI tool; UI and header/footer still to do). Text or image on selected pages ("DRAFT", "CONFIDENTIAL", dates, Bates numbers).
3. ✔ **Metadata viewer, editor and cleaner** (AI tool; UI still to do). Show author, producer, hidden data; strip everything before sharing. Complements redaction.
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

## Collaboration – working on documents together

Goal: review and approve PDFs as a team without leaving VS Code, with the AI as one more participant.

1. **Shareable annotations.** Highlights, comments and drawings are plain files in the project, so Git diffs, pull requests and shared folders already work. Make this robust: author name, timestamp, reply threads, resolved/open status per comment.
2. **Review mode.** Filter by author and status, jump between open comments, summary of all open points.
3. **Interoperability.** Import and export comments as XFDF / standard PDF annotations so Acrobat and other readers see them; round-trip tested.
4. **AI as a reviewer.** The AI can add comments (author "AI", clearly marked) and suggest redactions; a human accepts or rejects each one. Nothing is applied without approval.
5. **Live collaboration.** Evaluate VS Code Live Share and shared workspaces for real-time viewing of comments (the viewer itself is a webview, so sync happens through the comment files).
6. **Approval trail.** Optional log of who redacted, approved or signed what and when (no document content), exportable for audits.
7. **Review packages.** Bundle PDF + comments + verification report into one folder or ZIP to hand to a colleague or authority.

## More AI capabilities

Every AI feature works with any provider (Claude Code, OpenAI-compatible, local models via Ollama) and always shows what it will send before sending.

1. **Summaries and Q&A with page citations** for one PDF or the whole workspace (local index; optional local embeddings).
2. **Structured extraction** into JSON/CSV by a schema the user defines (invoices, contracts, forms), with page references and confidence.
3. **AI-assisted redaction suggestions** (names, addresses, health data, IDs) – human confirms every bar, verification stays independent.
4. **Form auto-fill** from another document or a user profile, with a review screen before anything is written.
5. **Document classification, naming and filing** (propose a new file name and folder; the user approves).
6. **Contract and document review** against a checklist the user provides (risks, missing clauses, deadlines, amounts).
7. **Translation** into a new PDF or Markdown, keeping page structure.
8. **Compare versions** and explain the differences in plain language.
9. **Scan quality and OCR second reader** for low-confidence pages (only with approval).
10. **Accessibility helpers**: alt text for images, reading order, tag suggestions.
11. **Recipes (workflows).** Saved multi-step jobs the AI or the user can run, for example "prepare for sharing": OCR → redact → strip metadata → compress → verify. Batch mode for whole folders.
12. **More MCP surface**: expose documents and comments as MCP resources, add MCP prompts for common tasks, and tools for everything above.

## Integration with Synaptik (remote control lives there)

Synaptik is a separate project: it runs the always-on server and the remote access from the phone. PDF Workbench does not open any network port itself. It only has to be a good, safe tool provider for Synaptik through its local MCP server.

What PDF Workbench needs for this:
- A stable, well-described MCP tool surface (names, parameters and results stay backwards compatible; every tool has a clear description).
- **Read-only mode** (for example `WERKBANK_READONLY=1`): only read and search tools are available; every tool that writes is hidden or refused. Remote sessions can start in this mode.
- **Folder allow-list** (exists today through `WERKBANK_ROOT`; extend to several folders).
- **Approval hook**: tools that change anything return a preview first and write only after an explicit confirmation passed in by the caller.
- No document content in logs or error messages; optional audit log with file names and actions only.
- Documented setup for connecting the server to Synaptik (command, environment variables, example config).

Security rules for any remote use (apply in Synaptik; PDF Workbench supports them): authenticated and encrypted access, folder allow-list, read-only by default, approval for every change, originals never overwritten, an off switch, and a visible "remote active" indication.

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
