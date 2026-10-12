# Stand und Plan (Version 0.7.2)

## Versionsverlauf (grob)
- 0.3.x–0.5.x: Betrachter, Markierungen, Kommentare, Seitenwerkzeuge, Zusammenfügen/Aufteilen, einfache Signatur, KI-Aufgaben (Zusammenfassung, Lernzettel, Quiz …), MCP-Server, echtes Schwärzen mit Prüfung.
- 0.6.0: Fehler melden / Feedback geben (Webview-Panel, Bericht ohne Inhalte).
- 0.7.0: Eingebaute OCR (tesseract.js, Deutsch+Englisch), MCP-Werkzeug `pdf_ocr`, Scan-Hinweis.
- 0.7.1: KI-Schaltfläche zeigt Name und Symbol der gewählten KI.
- 0.7.2: Fehlende Endpunkt/Modell-Einstellung ist eine Warnung mit Aktionen, kein Fehler.

## Getestet
- Schwärzen: Regressionssuite (a, b, c, lorem, rot, img) grün; qpdf-Prüfung, Text nachweislich weg.
- OCR: synthetische Scans (Schatten, Rauschen, Schräge, 4 Drehungen, Tabellen); ~96 % Wortrückruf sauber, ~87 % schief; Scan → OCR → Schwärzen durchgängig.
- Echter VS-Code-Lauf (Linux, 1.141) mit dem gepackten vsix: OCR, MCP (15 Werkzeuge), Editor, Anbieterwechsel.
- Windows (Paul): Fehler-melden-Dialog bestätigt. **OCR unter Windows noch nicht bestätigt.**

## Bekannte Grenzen
- OCR: 10–25 s pro Seite; Handschrift/Formeln unzuverlässig; nur Deutsch + Englisch; nur mit synthetischen Scans getestet.
- Bildsignatur ist nur eine einfache Signatur (rechtlich keine Schriftform).
- pdf.js-Schriften für CJK können im Schwärzen auf den Bild-Fallback gehen.
- MCP kann noch keine Markierungen/Kommentare schreiben.
- Claude-Symbol: niedrig aufgelöst, dunkler Hintergrund; vor Veröffentlichung Erlaubnis/Markenrichtlinie klären.
- Feedback-Ziele (`werkbank.feedback.githubRepo`, `.email`) nicht hinterlegt.

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
