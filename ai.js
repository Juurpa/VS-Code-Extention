'use strict';
// KI-Anbieter für den Werkbank. Alles hier ist austauschbar:
//  - "claude-code":  übergibt den Prompt an Claude Code (nutzt dein Abo, liest die Dateien selbst)
//  - "zwischenablage": kopiert den Prompt, du fügst ihn in eine beliebige KI ein
//  - "openai":       jeder Dienst mit OpenAI-kompatibler Schnittstelle (OpenAI, Gemini, OpenRouter, Ollama, LM Studio …)
//  - eigene:         andere Erweiterungen rufen api.registerProvider({...}) auf
const vscode = require('vscode');
const sc = require('./sidecar');

const cfg = () => vscode.workspace.getConfiguration('werkbank');
const dec = (b) => Buffer.from(b).toString('utf8');
const SECRET_KEY = 'werkbank.apiKey';

const RESULT_FILE = { 'summary-doc': 'zusammenfassung.md', learn: 'lernzettel.md', quiz: 'quiz.md', cards: 'karteikarten.md' };

const providers = new Map();

/** provider: { id, label, shortName?, icon?, description?, inline: boolean, run(prompt, ctx) -> Promise<string|void> }
 *  shortName: Name auf der Schaltfläche in der Werkbank (z. B. "Gemini"); icon: Daten-URI (PNG/SVG) oder Pfad unter media/ für das Symbol daneben.
 *  inline=false: der Anbieter liest die Dateien selbst (wie Claude Code); inline=true: der Text wird in den Prompt eingefügt
 *  und die zurückgegebene Antwort in eine Datei geschrieben. */
function registerProvider(p) {
  if (!p || !p.id || typeof p.run !== 'function') throw new Error('Anbieter braucht id und run()');
  providers.set(p.id, { inline: true, label: p.id, ...p });
  return { dispose: () => providers.delete(p.id) };
}

async function openClaude(promptText) {
  await vscode.env.clipboard.writeText(promptText);
  if (!cfg().get('openClaudeAfterPrompt')) { vscode.window.showInformationMessage('Prompt kopiert. In Claude Code einfügen (Strg+V).'); return; }
  const all = await vscode.commands.getCommands(true);
  const candidates = ['claude-vscode.sidebar.open', 'claude-vscode.editor.open', 'claude-vscode.focus', 'claude-vscode.sidebar.focus'];
  const found = candidates.find((c) => all.includes(c)) || all.find((c) => /^claude(-vscode)?\..*(open|focus)/i.test(c));
  if (found) {
    try { await vscode.commands.executeCommand(found); vscode.window.showInformationMessage('Prompt kopiert. In Claude Code mit Strg+V einfügen und senden.'); return; } catch (e) { /* weiter */ }
  }
  vscode.window.showWarningMessage('Prompt kopiert. Claude Code wurde nicht gefunden – installiere die Erweiterung „Claude Code“ oder füge den Prompt dort ein (Strg+V).');
}

function registerBuiltins(ctx) {
  registerProvider({
    id: 'claude-code', label: 'Claude Code (VS Code)', shortName: 'Claude', icon: 'icons/claude.png', description: 'Nutzt dein Claude-Abo. Claude liest die Dateien im Projekt selbst.',
    inline: false, run: async (prompt) => { await openClaude(prompt); }
  });
  registerProvider({
    id: 'zwischenablage', label: 'Nur kopieren', shortName: 'KI', description: 'Kopiert den Prompt samt Text, du fügst ihn in eine beliebige KI ein.',
    inline: true, handoff: true,
    run: async (prompt) => { await vscode.env.clipboard.writeText(prompt); vscode.window.showInformationMessage('Prompt mit Text kopiert. In deine KI einfügen (Strg+V).'); }
  });
  registerProvider({
    id: 'openai', label: 'OpenAI-kompatible Schnittstelle', shortName: 'KI', description: 'Endpunkt, Modell und Schlüssel in den Einstellungen. Funktioniert auch mit Ollama (lokal, kostenlos).',
    inline: true,
    run: async (prompt, { signal }) => {
      const base = String(cfg().get('ai.endpoint') || '').replace(/\/+$/, '');
      const model = cfg().get('ai.model');
      if (!base || !model) throw Object.assign(new Error('Für diese KI fehlen noch Endpunkt und Modell. Trag sie in den Einstellungen ein oder wähle eine andere KI.'), { code: 'CONFIG' });
      const key = await ctx.secrets.get(SECRET_KEY);
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = 'Bearer ' + key;
      const res = await fetch(base + '/chat/completions', {
        method: 'POST', headers, signal,
        body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Du bist ein Lernassistent. Antworte auf Deutsch, nutze nur den gegebenen Text und nenne Seitenzahlen.' }, { role: 'user', content: prompt }] })
      });
      if (!res.ok) throw new Error(`KI-Anfrage fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const j = await res.json();
      const out = j.choices?.[0]?.message?.content;
      if (!out) throw new Error('Leere Antwort der KI.');
      return out;
    }
  });
}

async function readIfExists(uri) { try { return dec(await vscode.workspace.fs.readFile(uri)); } catch (e) { return ''; } }

/** Führt eine Lernaufgabe mit dem gewählten Anbieter aus. */
async function runTask(ctx, kind, { relPdf, dataFolder, page, selection, count, dirUri, textUri, marksUri }) {
  const id = cfg().get('ai.provider') || 'claude-code';
  const p = providers.get(id) || providers.get('claude-code');
  const prompt = sc.buildPrompt(kind, { relPdf, dataFolder, page, selection, count });
  if (!p.inline) { await p.run(prompt, { kind }); return; }

  const max = Math.max(5000, +cfg().get('ai.maxChars') || 60000);
  let text = await readIfExists(textUri), marks = await readIfExists(marksUri);
  if (!text) { vscode.window.showWarningMessage('Der PDF-Text ist noch nicht abgelegt. Einen Moment warten und erneut versuchen.'); return; }
  if (kind === 'summary-page' && page) { // nur die gewünschte Seite
    const m = text.split(/\n(?=#+\s*Seite\s+\d+)/i).find((s) => new RegExp('^#+\\s*Seite\\s+' + page + '\\b', 'i').test(s));
    if (m) text = m;
  }
  if (text.length > max) text = text.slice(0, max) + '\n[… gekürzt]';
  const full = `${prompt}\n\n=== TEXT DER PDF (text.md) ===\n${text}\n\n=== MEINE MARKIERUNGEN (markierungen.md) ===\n${marks || '(keine)'}`;
  if (p.handoff) { await p.run(full, { kind }); return; }

  const ac = new AbortController();
  const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Werkbank: ${p.label} arbeitet …`, cancellable: true }, async (_pg, tok) => {
    tok.onCancellationRequested(() => ac.abort());
    return await p.run(full, { kind, signal: ac.signal });
  });
  if (!out) return;
  const file = RESULT_FILE[kind];
  if (file) {
    const uri = vscode.Uri.joinPath(dirUri, file);
    await vscode.workspace.fs.createDirectory(dirUri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(out, 'utf8'));
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside });
  } else {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: out });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }
}

async function pickProvider() {
  const cur = cfg().get('ai.provider') || 'claude-code';
  const items = [...providers.values()].map((p) => ({ label: (p.id === cur ? '$(check) ' : '') + p.label, description: p.id, detail: p.description, id: p.id }));
  const sel = await vscode.window.showQuickPick(items, { title: 'KI für den Werkbank wählen' });
  if (sel) await cfg().update('ai.provider', sel.id, vscode.ConfigurationTarget.Global);
}

async function setApiKey(ctx) {
  const v = await vscode.window.showInputBox({ title: 'API-Schlüssel (wird sicher im Schlüsselbund von VS Code gespeichert)', password: true, ignoreFocusOut: true, prompt: 'Leer lassen und bestätigen, um den Schlüssel zu löschen. Bei Ollama ist keiner nötig.' });
  if (v === undefined) return;
  if (v) { await ctx.secrets.store(SECRET_KEY, v); vscode.window.showInformationMessage('Schlüssel gespeichert.'); }
  else { await ctx.secrets.delete(SECRET_KEY); vscode.window.showInformationMessage('Schlüssel gelöscht.'); }
}

/** Name und Symbol der gewählten KI für die Oberfläche. */
function describe() {
  const id = cfg().get('ai.provider') || 'claude-code', p = providers.get(id);
  let name = (p && (p.shortName || p.label)) || id, icon = (p && p.icon) || null;
  if (id === 'openai') {
    const ep = String(cfg().get('ai.endpoint') || ''), model = String(cfg().get('ai.model') || '');
    name = /generativelanguage|gemini/i.test(ep + model) ? 'Gemini' : /11434|ollama/i.test(ep) ? 'Ollama' : /openai\.com/i.test(ep) ? 'OpenAI' : /anthropic/i.test(ep) ? 'Claude' : /openrouter/i.test(ep) ? 'OpenRouter' : /localhost|127\.0\.0\.1|1234/.test(ep) ? 'Lokale KI' : (model || 'KI');
  }
  return { id, name, icon };
}

module.exports = { describe, registerProvider, registerBuiltins, runTask, pickProvider, setApiKey, providers };
