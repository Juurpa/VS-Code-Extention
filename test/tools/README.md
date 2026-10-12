# Testwerkzeuge

Diese Skripte wurden in der Entwicklungsumgebung (Linux) geschrieben und haben **feste Pfade** (`/home/claude/lernmodus-vscode`, `/tmp/...`). Vor dem ersten Lauf Pfade anpassen (Suchen & Ersetzen). Sie sind nicht Teil der Erweiterung (`.vscodeignore` schließt `test/**` aus).

## ocr/ – Texterkennung und Schwärzen ohne Oberfläche (reines Node)
- `mkscan.mjs <quelle.pdf> <seite0> <aus.pdf> [rot] [schiefe°] [dpi]` baut einen künstlich verschlechterten Scan (Schatten, Rauschen, Schiefstellung, Seitendrehung) als Bild-PDF.
- `run.mjs <scan.pdf> <aus.pdf>` lässt die Texterkennung laufen und gibt Seiten, Wörter, Sicherheit, Dauer aus.
- `cmp.py <original.pdf> <ocr.pdf>` Trefferquote/Genauigkeit der Wörter (nutzt `pdftotext`).
- `pos.mjs <original.pdf> <ocr.pdf>` misst die Lage der unsichtbaren Wörter gegen die echten (in pt).
- `rotpdf.mjs`, `fast.mjs`, `e2e.mjs` (Scan → OCR → Schwärzen → Prüfen).
- `redact-suite.mjs <pdfs…>` Regressionstest für das Schwärzen (erwartet Max Mustermann/IBAN/E-Mail in den Beispiel-PDFs; Beispiele werden durch `../redact/gen.mjs` und die `.tex`-Dateien erzeugt).
- Externe Hilfsprogramme: `pdftotext`, `qpdf`, `pdflatex` (nur für Beispiel-PDFs).

## browser/ – Oberfläche (Webview) im normalen Browser
`build*.js` schreibt `harness*.html` (Mock von `acquireVsCodeApi`), `rsrv.mjs`/`osrv.mjs` sind kleine Server, die Schwärzen und OCR aus dem Browser heraus an die echte Engine weiterreichen. Die `t*.js`-Skripte steuern die Seite mit Playwright. Ein statischer Server auf Port 8765 muss das Projekt ausliefern (`python -m http.server 8765`).

## vscode/ – echter VS Code
`run.js` startet mit `@vscode/test-electron` ein echtes VS Code, das die **entpackte** .vsix lädt (`extensionDevelopmentPath`), `index.js` ist der Test (MCP-Server starten, OCR, Schwärzen, Editor öffnen). Unter Linux mit `xvfb-run`.
