# Screenshots without VS Code

Produces the README / Marketplace images in `media/screenshots/` by running the real webview UI
(`template.js` + `media/main.js`) in headless Chromium. A small mock answers the same messages as
`extension.js`; redaction and OCR go through the **real engines** (`mcp/ops.mjs`, `mcp/ocr.mjs`).
All demo content is fictional (Jane Example, Example GmbH, example.com, the public test IBAN).
These scripts are not part of the extension (`test/**` is excluded from the package).

## Files
| File | Purpose |
|---|---|
| `make-demo-pdf.mjs <dir>` | builds `invoice.pdf` (2 pages), `order-file.pdf` (6 pages) and `invoice.expect.json` (strings that must be gone / must stay after redaction) with `media/lib/pdf-lib.esm.min.js` |
| `make-scan.mjs <src.pdf> <page0> <out.pdf> [skew] [dpi]` | turns one page into a degraded image-only "scan" (shadow, noise, skew) |
| `serve.mjs <dir> [port]` | static server for the repo root, `<dir>` under `/__data/`, the harness page `/harness.html` (VS Code Dark Modern `--vscode-*` variables, mocked `acquireVsCodeApi`) and `/api/redact`, `/api/ocrScan`, `/api/ocr` |
| `shoot.mjs [reader] [tools] [redact] [ocr] [gif]` | Playwright script that drives the UI like a user and writes the images (no argument = all) |
| `verify-redaction.mjs <pdf> <expect.json>` | independent check of the redacted PDF (`pdftotext` + raw/hex scan of all streams) |

## Run
```bash
W=/tmp/shots; mkdir -p $W/data && cd $W && npm init -y && npm install playwright-core   # only in the scratch dir, never in the repo
R=/path/to/repo/test/tools/screenshots
node $R/make-demo-pdf.mjs $W/data
node $R/make-scan.mjs $W/data/invoice.pdf 0 $W/data/scan.pdf 1.1 200
node $R/serve.mjs $W/data 8765 &                       # needs node >= 18
WORK=$W CHROME=/path/to/chromium node $R/shoot.mjs      # OCR takes about 1 minute (CPU only, offline)
node $R/verify-redaction.mjs $W/out/invoice-redacted.pdf $W/data/invoice.expect.json
```
Environment of `shoot.mjs`: `WORK` (scratch dir with `node_modules/playwright-core`, `data/`), `OUT` (default `media/screenshots`),
`CHROME` (Chromium binary), `BASE` (default `http://localhost:8765`). Viewport 1280x800 at device scale factor 1.25 gives 1600x1000 images.
`ffmpeg` builds `demo.gif` (palettegen/paletteuse, 900 px wide). The PNGs were reduced with ImageMagick (`-colors`) where needed to stay below 600 KB.

## Known limits of this approach
- It is the real UI code, but not the real extension host: file dialogs, `saveAs`, `openMarks`, the AI call (`claude` message) and the feedback panel are only acknowledged.
- The harness sets `S.name` itself. The UI never does (see known issue below); without that, the merge dialog shows an empty file name.
- Fonts: "Segoe UI" is not available on Linux, so Inter is used as the fallback (same metrics class, slightly different look than on Windows).
- The sidebar shows page thumbnails only; highlights are listed in the text file behind the "Highlights" button, which is not rendered here.

## Issues found while building the screenshots (code not changed)
- `media/main.js:18` sets only `document.title`; `S.name` (util.js:5) stays empty, so file names derived from it are empty (`pages.js:8` baseName: split/extract names become `_S2.pdf`, `_new.pdf`; `pages.js:138` merge list; `pages.js:230` overwrite prompt). Fix: `S.name = cfg.name`.
- `media/tools.js` `applyRedactions`: after a successful redaction the toolbar still reads "N areas marked" with an enabled "Apply redaction" button (the options bar is not re-rendered; `S.red` is empty by then).
- `media/main.js:188` `setCur`: the first thumbnail is not marked as current until the first scroll (early return because `S.cur` already is 1).
- German leftovers: `media/main.js:398` and `media/tools.js:80` use the button label `'Abbrechen'` (should be `'Cancel'`); `mcp/ocr.mjs:15` has `LANGS = { deu: 'Deutsch', eng: 'Englisch' }` (only matters if shown to the AI/user).
- `media/ocr.js:44`: "Recognizing first of 1 pages …" (grammar for a single page).
