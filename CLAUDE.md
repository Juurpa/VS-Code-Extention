# Werkbank – Hinweise für Claude Code

Du übernimmst die Weiterentwicklung der **Werkbank**, einer VS-Code-Erweiterung (Ordner hieß früher „Lernmodus“, daher noch `lernmodus-vscode`). Lies zuerst diese Datei, danach `docs/ARCHITEKTUR.md` (wie alles zusammenhängt) und `docs/STAND-UND-PLAN.md` (was fertig ist, was als Nächstes kommt).

## Was wir bauen
Eine **Arbeitsumgebung für Dokumente in VS Code**, die teure Software ersetzen soll (Adobe Acrobat, Office, später auch Foto- und Videoschnitt), auch für den Einsatz bei Behörden und mit sensiblen Unterlagen. Leitidee: **Die KI bedient die Werkzeuge, der Mensch prüft, gibt frei und unterschreibt.** Die KI ist frei wählbar (Claude Code ist Standard, andere Anbieter über `ai.js` steckbar). Alles Wichtige läuft **lokal und offline** (Datenschutz ist ein Verkaufsargument).

Heute fertig: PDF lesen/markieren/kommentieren, Seitenwerkzeuge, Zusammenfügen/Aufteilen/Zuschneiden/Seitenzahlen/Komprimieren, **echtes Schwärzen mit erhaltener Struktur**, **eingebaute Texterkennung (OCR)**, einfache Bildsignatur, **MCP-Server mit 15 PDF-Werkzeugen für die KI**, Fehler-melden-/Feedback-Dialog, dynamische KI-Anzeige (Name und Symbol der gewählten KI).

## Der Nutzer
Paul (Justin Paul), Student Biomedizintechnik an der FH Dortmund, Windows-PC, deutsch. Er will **konkrete Ergebnisse statt langer Erklärungen** („minimaler Aufwand, maximale Wirkung“), testet selbst in seinem VS Code und schickt Fehlerberichte. Kommunikation auf Deutsch, kurz und ohne Floskeln. Oberflächentexte der Erweiterung sind **deutsch**, Code-Kommentare ebenfalls.
Auslieferung: Paket mit `npx @vscode/vsce package --allow-missing-repository -o werkbank-<version>.vsix`, Datei nach `C:\Users\321up\Documents` legen, Version in `package.json` (und `serverInfo.version` in `mcp/server.mjs`) hochzählen.

## Regeln, die nicht verhandelbar sind
- **Originale nie überschreiben.** Werkzeuge der KI schreiben neue Dateien (`freeName` in `mcp/server.mjs`), die Oberfläche fragt vor dem Überschreiben.
- **Schwärzen muss echt sein:** Text wird aus dem Seitencode gelöscht, nicht nur überdeckt, und danach **unabhängig geprüft** (`verifyGone`, `scrub`, `pdftotext`, `qpdf`). Nie eine Abkürzung einbauen, die den Text nur versteckt. Bei Zweifel Seite als Bild neu aufbauen (mit exakter Textebene ohne die geschwärzten Zeichen).
- **Keine Dokumentinhalte in Berichten, Logs, Fehlertexten.** `report.js` und `feedback.js` entfernen Pfade/Namen und hängen nie Inhalte an. Fehlertexte dürfen keine Fundstellen (Suchbegriffe, Treffertexte) enthalten.
- **Nichts wird automatisch gesendet.** Feedback/Berichte/Signaturen laufen nur nach ausdrücklicher Freigabe des Nutzers. Unterschreiben und Absenden macht der Mensch.
- **Keine Zugangsdaten verarbeiten:** Nie Passwörter, API-Schlüssel oder Ausweisdaten für den Nutzer eintragen oder ausgeben (Schlüssel liegen in `SecretStorage`). Konten (z. B. Skribble) legt Paul selbst an.
- **Lizenzen:** Jede neue Abhängigkeit mit Lizenz in `THIRD_PARTY_LICENSES.md` und `NOTICE` eintragen, Lizenzdatei ins Paket (`.vscodeignore`-Whitelist). Projekt ist Apache-2.0. Keine Logos/Marken Dritter ohne Erlaubnis in der veröffentlichten Version (siehe Plan).
- **Ehrlich bleiben:** Die Bildsignatur ist nur eine *einfache* Signatur und rechtlich keine Schriftform. Das muss in der Oberfläche so benannt werden. Grenzen (Handschrift, Formeln, Scans mit Schatten) offen nennen.

## Befehle
```
npm install                                   # Abhängigkeiten
npx @vscode/vsce package --allow-missing-repository -o werkbank-X.Y.Z.vsix
code --install-extension werkbank-X.Y.Z.vsix  # lokal testen
node --check <datei>                          # schneller Syntaxtest (media/*.js sind ES-Module, media/package.json setzt type=module)
```
Tests: siehe `test/tools/README.md` (Pfade sind für Linux geschrieben und müssen angepasst werden). Mindestens vor jeder Auslieferung: Schwärzen-Regression (`redact-suite.mjs`), OCR auf einem Test-Scan (`mkscan.mjs` + `run.mjs`), echter VS-Code-Lauf (`test/tools/vscode`).

## Stolpersteine (schon einmal schiefgegangen)
- MCP-Server (`mcp/server.mjs`): **stdout gehört dem Protokoll.** Bibliotheken, die `console.log` nutzen (pdf.js), brechen es; `mcp/quiet.mjs` leitet auf stderr um und muss als Erstes importiert werden.
- Der MCP-Server wird mit VS Codes eigener Node-Laufzeit gestartet (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), damit der Nutzer kein Node braucht. `.mcp.json` schreibt der Befehl `werkbank.setupMcp`.
- `pdf-lib` schreibt verwaiste Objekte mit; nach Änderungen `collectGarbage` (in `mcp/vredact.mjs`), sonst bleibt alter Inhalt in der Datei.
- `pdf.js` meldet `TJ` als `showText`; Operatorliste mit `annotationMode: DISABLE` holen.
- Tesseract-Kern: tesseract.js 7 lädt über `getCore` die **Nicht-LSTM-Kerne** (`tesseract-core*.wasm`), obwohl nur LSTM-Daten genutzt werden. Deshalb liegen im Paket nur die drei Kerne ohne `-lstm` im Namen (siehe `.vscodeignore`).
- OCR-Auflösung ist entscheidend: bei 200 dpi brach die Erkennung ein (15 statt 26 Wörter), ab 250 dpi gut. Es gibt eine automatische Wiederholung bei höherer Auflösung.
- Schiefe Scans: Text pro Zeile auf **eine gemeinsame Grundlinie** legen, nicht pro Wort drehen, sonst zerfällt die Textextraktion (poppler/pdfium) in Wortschnipsel.
- Kein `pkill -f` mit Mustern, die im eigenen Befehl vorkommen.
- Neue `window`/Webview-Nachrichten brauchen eine Antwort (`rid`) oder werden still verschluckt; Fehler in `extension.js` laufen durch den gemeinsamen `catch` (zeigt „Fehler melden“, außer `e.code === 'CONFIG'`).
