# PDF Workbench (Werkbank)

Read, annotate, redact, merge, split and OCR PDFs in VS Code – offline, with the AI of your choice. Everything runs locally; nothing is sent without your approval. (Deutsch siehe unten.)

Eine Arbeitsumgebung für Dokumente in VS Code. Alles liegt als normale Datei im Projektordner, die KI deiner Wahl kennt alles und du behältst die Kontrolle.

## PDF
- Lesen, markieren, kommentieren, zeichnen, Karteikarten aus Markierungen
- Seiten drehen, löschen, duplizieren, umsortieren (Ziehen), extrahieren, einfügen
- Zusammenfügen, aufteilen, zuschneiden, Seitenzahlen, komprimieren
- Schwärzen mit erhaltener Struktur: die Buchstaben unter dem Balken werden aus dem Seitencode gelöscht (Schrift, Layout, Links, Lesezeichen bleiben wie im Original), danach wird die Datei geprüft (bei Scans zuerst Texterkennung); nur wenn das nicht sicher geht (z. B. Foto unter dem Balken), wird die Seite als Bild mit Textlayer neu aufgebaut
- Texterkennung (OCR) für Scans, offline: Deutsch und Englisch, erkennt gedrehte Seiten, Tabellen und Formulare; das Bild bleibt unverändert, der Text liegt unsichtbar dahinter (durchsuchbar, markierbar, schwärzbar). Handschrift und Formeln werden nicht zuverlässig erkannt
- Unterschrift (einfache Signatur)
- Fehler melden und Feedback geben (Befehl oder Werkzeuge-Menü): der Bericht enthält nie Dokumentinhalte, wird vor dem Senden angezeigt und erst nach deiner Freigabe verschickt
- PDF-Werkzeuge für die KI (MCP): Befehl „Werkbank: PDF-Werkzeuge für die KI einrichten“ schreibt eine `.mcp.json`; Claude Code kann dann lesen, suchen, schwärzen, zusammenfügen, aufteilen, drehen, zuschneiden und mehr
- Rückgängig/Wiederholen auch für Seiten-Änderungen

## KI nach Wahl
Befehl „Werkbank: KI-Anbieter wählen“: Claude Code (Standard), nur kopieren, oder jede OpenAI-kompatible Schnittstelle (OpenAI, Gemini, OpenRouter, Ollama lokal). Endpunkt und Modell stehen in den Einstellungen, der Schlüssel liegt im Schlüsselbund von VS Code.

## Für Entwickler
```js
const api = vscode.extensions.getExtension("it-biene.pdf-workbench").exports;
api.registerProvider({ id: "mein", label: "Mein Anbieter", run: async (prompt, { signal }) => "Antwort" });
```

Der Text und die Markierungen jeder PDF liegen unter `_werkbank/<pdf-pfad>/` (text.md, markierungen.md). „Werkbank: Claude Code Hinweis in CLAUDE.md eintragen“ sorgt dafür, dass Claude Code sie zuerst liest.

## Datenschutz
- Alles Wichtige läuft lokal auf deinem Rechner: PDF-Bearbeitung, Schwärzen und Texterkennung (OCR) brauchen keine Internetverbindung.
- Die Werkbank sendet von sich aus nichts. Fehlerberichte und Feedback entstehen nur nach deiner ausdrücklichen Freigabe, werden vorher angezeigt und enthalten nie Dokumentinhalte.
- Nur wenn du selbst eine KI wählst (z. B. Claude Code oder eine OpenAI-kompatible Schnittstelle), gehen Texte an diesen Anbieter. Bei sensiblen Unterlagen wähle „nur kopieren“ oder ein lokales Modell (z. B. Ollama).
- API-Schlüssel liegen im Schlüsselbund von VS Code (SecretStorage), nicht in Dateien.

## Hinweis zur Unterschrift
Die Bildsignatur ist nur eine einfache Signatur und rechtlich keine Schriftform.
