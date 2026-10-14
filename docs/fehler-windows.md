# Fehler und Auffälligkeiten unter Windows (Testlauf 12.10.2026)

Testumgebung: Windows 11 Pro (10.0.26200), VS Code mit Erweiterung `juurpa.pdf-workbench` 0.7.5 installiert, Repo-Stand 0.8.0, Windows PowerShell 5.1, Node 24 (nur für Hilfsskripte).
Getestet wurde der MCP-Server (`mcp/server.mjs`) mit der VS-Code-eigenen Node-Laufzeit (`ELECTRON_RUN_AS_NODE=1`) an einem Arbeitsordner mit Leerzeichen, Klammern und Komma im Pfad. Dieser Bericht enthält keine Inhalte der getesteten Dokumente.

## Behoben in 0.8.1 (Branch `fix/windows-test`)
| Nr. | Beobachtung | Ursache | Korrektur |
|---|---|---|---|
| 1 | KI-Client meldet nur „Connection closed“, Server startet nicht. | `.mcp.json` enthielt den Pfad zu `server.mjs` mit Erweiterungs-ID **und Version** (`…\extensions\<id>-<version>\mcp\server.mjs`). Nach Umbenennung/Update gibt es diesen Ordner nicht mehr. Die Meldung nennt den Grund nicht. | Beim Start prüft die Erweiterung, ob der Pfad in `.mcp.json` existiert, und bietet „Repair now“ an (führt `pdfWorkbench.setupMcp` aus, nur nach Klick). `setupMcp` entfernt außerdem den alten Eintrag `werkbank`. |
| 2 | Aufruf eines Werkzeugs mit falschem Argumentnamen meldet `File not found: undefined`. | `readPdf` prüfte nicht, ob das Argument vorhanden ist. | Klare Meldung: `Missing argument "file": path of the PDF, relative to the working folder.` |
| 3 | `pdf_info` liefert bei einem 26-Seiten-Buch 26 gleiche Einträge (lange Ausgabe, verbraucht KI-Kontext). | Pro Seite ein Objekt. | Gleich große, aufeinanderfolgende Seiten werden zu einem Eintrag `{ "pages": "1-26", … }` zusammengefasst. |
| 4 | `pdf_read_text` enthält das Steuerzeichen U+0002 mitten in Wörtern (Silbentrennstrich am Zeilenende). Suchen und Lesen werden dadurch unzuverlässig. | pdf.js meldet den Trennstrich als U+0002. | Im Ausgabetext wird U+0002 durch `-` ersetzt (Geometrie für Suchen/Schwärzen unverändert). |
| 5 | Bei jedem Start schreibt der Server `Warning: Please use the legacy build in Node.js environments.` in stderr. | pdf.js im Nicht-Legacy-Build. | In `mcp/quiet.mjs` wird genau diese harmlose Meldung nicht mehr ausgegeben. |
| 6 | Beschreibung von `pdf_ocr` nennt „10–25 Sekunden pro Seite“. | Veraltete Schätzung. | Gemessen: 9 Scanseiten (A4) in 25 s, also etwa 3 s pro Seite, bei Konfidenz 87–94 %. Text korrigiert. |
| 7 | Daten-Ordner, Befehle, Einstellungen und Umgebungsvariablen hießen noch „werkbank“. | Alter Projektname. | Umbenannt auf „PDF Workbench“: Befehle `pdfWorkbench.*`, Einstellungen `pdfWorkbench.*`, Datenordner `_pdf-workbench`, Variablen `PDF_WORKBENCH_ROOT` und `PDF_WORKBENCH_DATA`. Die alten `WERKBANK_*`-Variablen werden vom Server weiter gelesen. |

## Gemessen
- Start des MCP-Servers bis Antwort auf `initialize`: ca. 0,2 s.
- `pdf_info` / `pdf_read_text` auf Dokumenten mit 8–26 Seiten: unter 0,5 s.
- `pdf_ocr` auf einem 9-seitigen A4-Scan: 25 s gesamt; zwei gedrehte Seiten (90°) wurden selbst erkannt.
- Pfade mit Leerzeichen, Klammern, Komma, langem Gedankenstrich (–) und Umlauten funktionierten ohne Probleme (Arbeitsordner und Dateinamen).
- Während der OCR gibt es keine Fortschrittsanzeige; auf stderr erscheinen nur `Estimating resolution as …`-Meldungen.

## Offen / nicht in dieser Version behoben
- **Version im Pfad bleibt:** `setupMcp` schreibt weiterhin einen versionsabhängigen Pfad. Die Prüfung beim Start fängt das ab, ein versionsunabhängiger Startpfad wäre besser (z. B. fester Pfad außerhalb des Erweiterungsordners).
- **Kein Fortschritt bei OCR** (MCP unterstützt `notifications/progress`; Client muss ein `progressToken` senden).
- **Ausgabeformat von `pdf_read_text`:** JSON mit Escapes (`\n`, `\u…`) ist für KI und Menschen unhandlich. Ein reines Textformat pro Seite wäre kompakter.
- **Alte Datenordner:** Wer die Version 0.7.x genutzt hat, hat einen Ordner `_werkbank` (Texte, Markierungen). Der neue Standard heißt `_pdf-workbench`; vorhandene Daten werden nicht automatisch verschoben. Entweder umbenennen oder die Einstellung `pdfWorkbench.dataFolder` auf `_werkbank` setzen.
- **`package-lock.json`** führte noch Version 0.6.0 (nicht angepasst).
- **Test-Skripte** (`test/tools`) haben feste Linux-Pfade (siehe `test/tools/README.md`) und laufen unter Windows nicht ohne Anpassung.
- **Hilfsskript-Stolperstein (nicht Teil der Erweiterung):** Windows PowerShell 5.1 entfernt Anführungszeichen in Argumenten an native Programme. JSON-Argumente deshalb über eine Datei übergeben.
