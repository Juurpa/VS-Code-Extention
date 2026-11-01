# Stand und Plan (Version 0.10.0)

## Versionsverlauf (grob)
- 0.3.x–0.5.x: Betrachter, Markierungen, Kommentare, Seitenwerkzeuge, Zusammenfügen/Aufteilen, einfache Signatur, KI-Aufgaben (Zusammenfassung, Lernzettel, Quiz …), MCP-Server, echtes Schwärzen mit Prüfung.
- 0.6.0: Fehler melden / Feedback geben (Webview-Panel, Bericht ohne Inhalte).
- 0.7.0: Eingebaute OCR (tesseract.js, Deutsch+Englisch), MCP-Werkzeug `pdf_ocr`, Scan-Hinweis.
- 0.7.1: KI-Schaltfläche zeigt Name und Symbol der gewählten KI.
- 0.7.2: Fehlende Endpunkt/Modell-Einstellung ist eine Warnung mit Aktionen, kein Fehler.
- 0.8.x: Englisch als Basis, 8 Sprachen, Signaturbibliothek, Schnellleiste, `pdf_compare`.
- 0.9.0: Text bearbeiten (echt, `mcp/edittext.mjs`, KI-Werkzeug `pdf_replace_text`), Text/Bild einfügen, Unterstreichen/Durchstreichen, Formen, Seitenleiste mit Markierungsliste/Suche/Inhalt, Datei-Menü (Kopie speichern unter, eingebrannt oder als echte PDF-Kommentare), Drucken (über das PDF-Programm), E-Mail-Entwurf (.eml mit Anhang), frei anpassbare Leiste, dunkle Seiten, Neuladen bei Änderung von außen.
- 0.10.0: Word (.docx), PowerPoint (.pptx) und Bilder (JPG/PNG/GIF/BMP/WebP) öffnen: Umwandlung in PDF im Webview (`media/convert.js`, `mcp/imgpdf.mjs`), Original bleibt unverändert, „Als PDF speichern“. Getestet im Chrome-Harness und in echtem VS Code 1.143 (Windows) mit der gepackten vsix.

## Getestet
- Schwärzen: Regressionssuite (a, b, c, lorem, rot, img) grün; qpdf-Prüfung, Text nachweislich weg.
- OCR: synthetische Scans (Schatten, Rauschen, Schräge, 4 Drehungen, Tabellen); ~96 % Wortrückruf sauber, ~87 % schief; Scan → OCR → Schwärzen durchgängig.
- Echter VS-Code-Lauf (Linux, 1.141) mit dem gepackten vsix: OCR, MCP (15 Werkzeuge), Editor, Anbieterwechsel.
- Windows (Paul): Fehler-melden-Dialog bestätigt. **OCR und MCP-Start unter Windows 11 bestätigt (Version 0.8.1, siehe `docs/fehler-windows.md`).**

## Bekannte Grenzen
- Word/PowerPoint: Darstellung durch Browser-Renderer, kann leicht von Office abweichen (nicht installierte Schriften, SmartArt, Word-Dateien ohne gespeicherte Seitenumbrüche). Seiten sind Bilder mit Textebene, kein bearbeitbarer Office-Text. .doc/.ppt nicht unterstützt. Bisher nur mit erzeugten Testdateien (python-docx/python-pptx) geprüft, noch nicht mit echten Office-Dateien.
- Suchtreffer-Rechtecke (`rectsFor` in `media/panel.js`) nehmen innerhalb eines pdf.js-Textstücks gleich breite Zeichen an und können um ein Zeichen versetzt sein; fällt bei umgewandelten Word-Seiten mit langen Zeilen auf.
- OCR: ca. 3 s pro A4-Seite (Windows 11, gemessen), je nach Rechner bis ca. 25 s; Handschrift/Formeln unzuverlässig; nur Deutsch + Englisch; nur mit synthetischen Scans getestet.
- Bildsignatur ist nur eine einfache Signatur (rechtlich keine Schriftform).
- pdf.js-Schriften für CJK können im Schwärzen auf den Bild-Fallback gehen.
- MCP kann noch keine Markierungen/Kommentare schreiben.
- Claude-Symbol durch eigenes neutrales Symbol (media/icons/ai.png) ersetzt.
- Feedback-Ziele (`pdfWorkbench.feedback.githubRepo`, `.email`) nicht hinterlegt.

## Backlog (Reihenfolge)
1. **Design-/Live-Vorschau-Modul** (Handy-Apps, Icons, HTML mit Live-Vorschau, auch als MCP-Werkzeuge).
2. **Signatur-Anbieter-Abstraktion** mit Skribble-Anschluss (Mock-Tests; Demo-Schlüssel trägt Paul selbst per SecretStorage ein; Anfrage als Partner sendet Paul selbst). Bildsignatur ehrlich als „einfache Signatur (nicht rechtsgültig im Sinne der Schriftform)“ benennen.
3. **Passwortschutz** (AES-256 über qpdf) und Entschlüsseln.
4. MCP: Markierungen/Kommentare schreiben.
5. OCR: Claude als zweiter Leser für Seiten mit niedriger Sicherheit (optional, nur mit Freigabe).
6. Foto-/Videomodul (später).
7. Web/PWA-, Desktop- und Mobilversion.

## Vor der Veröffentlichung (Marketplace/GitHub)
- Repo anlegen (Paul), `repository`/`bugs` in `package.json`, Feedback-Ziele setzen, Spendenlink, Lizenzen-Tab.
- Lizenzen prüfen: PDFium-Bibliotheken, fontkit-Text, Leptonica, Herkunft tessdata_best (TODO in `THIRD_PARTY_LICENSES.md`).
- Claude-/Anthropic-Symbol ersetzen oder Erlaubnis einholen.
- Datenschutzhinweis (alles lokal; Bericht nur nach Freigabe).
- Echte Windows-Tests (OCR, MCP-Start, Pfade mit Leerzeichen/Umlauten).
