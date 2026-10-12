# Architektur

## Überblick
```
VS Code
 ├─ extension.js            Erweiterungsprozess (Node/Electron): Befehle, Custom Editor, Nachrichten mit dem Webview
 │   ├─ ai.js               KI-Anbieter-Register (claude-code, zwischenablage, openai-kompatibel, fremde Erweiterungen)
 │   ├─ feedback.js+report.js  Fehler melden / Feedback (Dialog als Webview-Panel, Bericht ohne Inhalte)
 │   ├─ sidecar.js          Hilfsdateien neben der PDF (Text, Markierungen) und CLAUDE.md-Snippet
 │   └─ import() von mcp/*.mjs  gemeinsame Engines für Schwärzen und OCR (dieselben wie im KI-Server)
 ├─ Webview "werkbank.pdfEditor" (media/*.js, template.js)   Oberfläche, pdf.js, pdf-lib
 └─ MCP-Server (mcp/server.mjs)  eigener Prozess, wird von Claude Code gestartet (stdio, JSON-RPC)
```

## Wichtige Dateien
| Datei | Aufgabe |
|---|---|
| `package.json` | Befehle, Einstellungen (`werkbank.*`), Custom-Editor-Registrierung, Abhängigkeiten |
| `extension.js` | `PdfEditorProvider` (Custom Editor, schreibgeschützt; Speichern geht über Nachrichten), Nachrichten `ready, saveAnn, saveText, saveCopy, redact, ocr, ocrScan, ocrCancel, report, jsError, saveFile, saveAs, saveMany, pickPdfs, chooseAi, setupMcp …`; Befehle `werkbank.setupMcp, reportProblem, sendFeedback, chooseAi, setApiKey, showLicenses, revealData, internal.*` (die `internal.*` sind nur für Tests) |
| `template.js` | HTML-Gerüst des Betrachters (Werkzeugleiste, Seitenleiste, Modal-Wurzel) |
| `media/main.js` | Start, Rendern der Seiten (pdf.js), Auswahl/Markieren, Menüs (Werkzeuge, Claude/KI), `applyAi` |
| `media/pages.js` | Seitenwerkzeuge (drehen, löschen, umsortieren, zusammenfügen, aufteilen …), Speichern, `commit()` (Undo-fähige Änderung des Dokuments) |
| `media/pdfops.js` | reine pdf-lib-Operationen auf Bytes (wird auch vom MCP-Server genutzt: darum kein DOM-Zugriff!) |
| `media/tools.js` | Zeichnen, Radierer, Schwärzen-Oberfläche (`applyRedactions` → Nachricht `redact`), Unterschrift |
| `media/ocr.js` | OCR-Dialog (Seiten wählen, Fortschritt, Abbrechen) → Nachricht `ocr` |
| `media/util.js` | Zustand `S`, `el()`-Helfer, `toast` (Fehler-Toasts sind anklickbar → Bericht), `modal`, Icons |
| `media/lib/` | mitgelieferte Fremdbibliotheken: pdf.js 4.10.38, pdf-lib, Schriften (Liberation Sans), cmaps |
| `mcp/server.mjs` | MCP-Server, 15 Werkzeuge (`pdf_info, pdf_read_text, pdf_read_marks, pdf_find, pdf_redact, pdf_ocr, pdf_merge, pdf_split, pdf_extract_pages, pdf_delete_pages, pdf_rotate, pdf_reorder, pdf_crop, pdf_number_pages, pdf_compress`), Pfad-Sandbox (`safe()` im Arbeitsordner), überschreibt nie |
| `mcp/ops.mjs` | Suchen (`KINDS`: IBAN, E-Mail, Telefon, Datum, PLZ/Ort, URL, 11-stellig, Kreditkarte mit Luhn), `redact`, `redactVerified`, `verifyGone`, `scrub` |
| `mcp/vredact.mjs` | Schwärzen im Seitencode: pdf.js-Operatorliste → Zeichen löschen, Lücken per TJ-Zahlen erhalten, Balken zeichnen, Formularfelder/Anmerkungen leeren, `flattenPage` als Bild-Notlösung, `collectGarbage` |
| `mcp/content.mjs` | Tokenizer für Content-Streams |
| `mcp/pdftext.mjs` | PDFium (WASM, `@hyzyla/pdfium`): Zeichenkästen, Rendern, PNG-Encoder |
| `mcp/textlayer.mjs` | Unsichtbare Textebene für Bild-Seiten (aus pdfium-Zeichen, ohne die geschwärzten) |
| `mcp/ocr.mjs` | OCR: Bild aufbereiten, Ausrichtung, Tesseract (Worker), zweiter Durchgang, unsichtbare Wörter schreiben |
| `ocr-data/` | `deu.traineddata.gz`, `eng.traineddata.gz` (tessdata_best, ganzzahlig quantiert) |
| `ai.js` | Anbieter-Register; `describe()` liefert Name und Symbol für die Schaltfläche; `runTask` erzeugt Prompts je Aufgabe (Zusammenfassung, Lernzettel, Quiz, Karteikarten …) |

## Ablage neben der PDF (Sidecar)
`_werkbank/<Pfad der PDF ohne .pdf>/` im Arbeitsordner (Einstellung `werkbank.dataFolder`): `annotations.json` (Markierungen/Zeichnungen/Kommentare/Unterschriften), `markierungen.md` (lesbar für die KI), `text.md` (Text je Seite). Claude liest diese Dateien; über `pdf_read_marks` auch per MCP.

## Nachrichten Webview ↔ Erweiterung
Webview sendet `{type, rid?, …}`; Antworten kommen als `{type:'reply', rid, …}`. Fortschritt (OCR) als `{type:'progress', rid, done, total, page}`. KI-Wechsel als `{type:'ai', ai:{id,name,icon}}`. Große Dateien gehen als Base64 (`toB64`/`b64ToBytes` in `media/pages.js`).

## Schwärzen (Kernstück)
1. Treffer finden (PDFium-Zeichenkästen) oder Kästen aus der Oberfläche.
2. Pro Seite im Seitencode die betroffenen Zeichencodes durch Kerning-Zahlen ersetzen, sodass das Layout gleich bleibt; schwarze Rechtecke anhängen; Anmerkungen/Felder darunter leeren; Vorschaubilder/Metadaten der betroffenen Seiten entfernen.
3. Fallback je Seite (Foto/Kurve unter dem Balken, nicht eindeutig zuordenbar, senkrechte Schrift, gemischte Codelängen, geteilte Form-XObjects): Seite als Bild rendern mit eingebranntem Balken + unsichtbare Textebene (Originaltext ohne geschwärzte Zeichen).
4. Prüfung (`verifyGone`): rohe Bytes, entpackte Streams (latin1/utf16/utf8), alle Wörterbuch-Strings, Seitentext per PDFium; geometrisch (`checkVectorPages`: kein Zeichenmittelpunkt in einem Balken); `scrub` leert Info/Lesezeichen/XMP, falls dort Treffer stehen. Fehlschlag auf einer Seite → diese Seite wird als Bild neu gemacht.
5. Scan-Seiten haben keinen Text: erst OCR, dann Schwärzen (getestet: Treffer liegt im Bild → Bildfallback mit Textebene).

## OCR
`ocrPdf(bytes, {pages, langs, fast, force, signal, onProgress, workers})`
1. `detectScanned`: Seite gilt als Scan bei < 5 Textzeichen.
2. Rendern mit 300 dpi (`fast`: 250), `enhance()`: Graustufen, Hintergrund per Max-Filter schätzen und herausteilen (Schatten), leichtes Entrauschen, Kontrast strecken, lange dünne Linien (Tabellenränder) entfernen.
3. Ausrichtung: `axisOf` (waagerecht/senkrecht über Zeilenprofil), dann auf halber Auflösung beide Richtungen mit Tesseract vergleichen (`score`).
4. Tesseract (tesseract.js, LSTM, Deutsch+Englisch) Seitenmodus 3; zusätzlich Modus 11 (verstreuter Text) und nur Wörter ergänzen, die noch nicht abgedeckt sind (Tabellen/Formulare). Bei schwacher Erkennung (<72 %) Wiederholung mit 1,4-facher Auflösung.
5. `writeLayer`: je Wort unsichtbarer Text (Modus 3, Liberation Sans), Breite per Matrixskalierung auf den Wortkasten, gemeinsame Grundlinie je Zeile; Rückrechnung über Bilddrehung und `/Rotate` der Seite in Seitenkoordinaten.
6. Mehrere Arbeiter (bis 3, `os.cpus()-1`), Abbruch per `AbortSignal`.

## KI-Anbieter
`ai.registerProvider({id, label, shortName?, icon?, description?, inline, run(prompt, ctx)})`. `inline:false` = Anbieter liest Dateien selbst (Claude Code); `inline:true` = Text wird in den Prompt eingefügt, Antwort wird als Datei abgelegt. Einstellungen `werkbank.ai.provider/endpoint/model`, Schlüssel in `SecretStorage` (`werkbank.setApiKey`). Fremderweiterungen erhalten über den Rückgabewert von `activate()` ein `registerProvider`.

## Fehler melden
`feedback.open(ctx, {type,title,what,pdf})` öffnet ein Webview-Panel; Bericht = `report.buildReport` (Systemdaten, letzte Fehler aus einem Ringspeicher, optional PDF-Eckdaten), alles durch `report.scrub`. Ziele: `werkbank.feedback.githubRepo` (oder `bugs`/`repository` aus `package.json`) und `werkbank.feedback.email`; zusätzlich Kopieren und Datei speichern. **Ziel noch nicht hinterlegt** (siehe Plan).
