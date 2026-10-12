'use strict';
// AI providers for Werkbank. Everything here is replaceable:
//  - "claude-code":  hands the prompt to Claude Code (uses your subscription, reads the files itself)
//  - "zwischenablage": copies the prompt; you paste it into any AI
//  - "openai":       any service with an OpenAI-compatible interface (OpenAI, Gemini, OpenRouter, Ollama, LM Studio …)
//  - custom:         other extensions call api.registerProvider({...})
const vscode = require('vscode');
const sc = require('./sidecar');

const cfg = () => vscode.workspace.getConfiguration('werkbank');
const dec = (b) => Buffer.from(b).toString('utf8');
const SECRET_KEY = 'werkbank.apiKey';

const RESULT_FILE = { 'summary-doc': 'summary.md', learn: 'study-notes.md', quiz: 'quiz.md', cards: 'flashcards.md' };

const providers = new Map();

/** provider: { id, label, shortName?, icon?, description?, inline: boolean, run(prompt, ctx) -> Promise<string|void> }
 *  shortName: name on the button in Werkbank (e.g. "Gemini"); icon: data URI (PNG/SVG) or path under media/ for the icon next to it.
 *  inline=false: the provider reads the files itself (like Claude Code); inline=true: the text is inserted into the prompt
 *  and the returned answer is written to a file. */
function registerProvider(p) {
  if (!p || !p.id || typeof p.run !== 'function') throw new Error('Provider needs id and run()');
  providers.set(p.id, { inline: true, label: p.id, ...p });
  return { dispose: () => providers.delete(p.id) };
}

async function openClaude(promptText) {
  await vscode.env.clipboard.writeText(promptText);
  if (!cfg().get('openClaudeAfterPrompt')) { vscode.window.showInformationMessage('Prompt copied. Paste it into Claude Code (Ctrl+V).'); return; }
  const all = await vscode.commands.getCommands(true);
  const candidates = ['claude-vscode.sidebar.open', 'claude-vscode.editor.open', 'claude-vscode.focus', 'claude-vscode.sidebar.focus'];
  const found = candidates.find((c) => all.includes(c)) || all.find((c) => /^claude(-vscode)?\..*(open|focus)/i.test(c));
  if (found) {
    try { await vscode.commands.executeCommand(found); vscode.window.showInformationMessage('Prompt copied. Paste it into Claude Code with Ctrl+V and send it.'); return; } catch (e) { /* continue */ }
  }
  vscode.window.showWarningMessage('Prompt copied. Claude Code was not found. Install the “Claude Code” extension or paste the prompt there (Ctrl+V).');
}

function registerBuiltins(ctx) {
  registerProvider({
    id: 'claude-code', label: 'Claude Code (VS Code)', shortName: 'Claude', icon: 'icons/ai.png', description: 'Uses your Claude subscription. Claude reads the files in the project itself.',
    inline: false, run: async (prompt) => { await openClaude(prompt); }
  });
  registerProvider({
    id: 'zwischenablage', label: 'Copy only', shortName: 'KI', description: 'Copies the prompt including the text; you paste it into any AI.',
    inline: true, handoff: true,
    run: async (prompt) => { await vscode.env.clipboard.writeText(prompt); vscode.window.showInformationMessage('Prompt with text copied. Paste it into your AI (Ctrl+V).'); }
  });
  registerProvider({
    id: 'openai', label: 'OpenAI-compatible interface', shortName: 'KI', description: 'Endpoint, model and key are set in the settings. Also works with Ollama (local, free).',
    inline: true,
    run: async (prompt, { signal }) => {
      const base = String(cfg().get('ai.endpoint') || '').replace(/\/+$/, '');
      const model = cfg().get('ai.model');
      if (!base || !model) throw Object.assign(new Error('This AI still needs an endpoint and a model. Enter them in the settings or choose another AI.'), { code: 'CONFIG' });
      const key = await ctx.secrets.get(SECRET_KEY);
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = 'Bearer ' + key;
      const res = await fetch(base + '/chat/completions', {
        method: 'POST', headers, signal,
        body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are a study assistant. Answer in English, use only the given text and cite page numbers.' }, { role: 'user', content: prompt }] })
      });
      if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const j = await res.json();
      const out = j.choices?.[0]?.message?.content;
      if (!out) throw new Error('Empty response from the AI.');
      return out;
    }
  });
}

async function readIfExists(uri) { try { return dec(await vscode.workspace.fs.readFile(uri)); } catch (e) { return ''; } }

/** Runs a study task with the selected provider. */
async function runTask(ctx, kind, { relPdf, dataFolder, page, selection, count, dirUri, textUri, marksUri }) {
  const id = cfg().get('ai.provider') || 'claude-code';
  const p = providers.get(id) || providers.get('claude-code');
  const prompt = sc.buildPrompt(kind, { relPdf, dataFolder, page, selection, count });
  if (!p.inline) { await p.run(prompt, { kind }); return; }

  const max = Math.max(5000, +cfg().get('ai.maxChars') || 60000);
  let text = await readIfExists(textUri), marks = await readIfExists(marksUri);
  if (!text) { vscode.window.showWarningMessage('The PDF text has not been stored yet. Wait a moment and try again.'); return; }
  if (kind === 'summary-page' && page) { // only the requested page
    const m = text.split(/\n(?=#+\s*(?:Seite|Page)\s+\d+)/i).find((s) => new RegExp('^#+\\s*(?:Seite|Page)\\s+' + page + '\\b', 'i').test(s));
    if (m) text = m;
  }
  if (text.length > max) text = text.slice(0, max) + '\n[… truncated]';
  const full = `${prompt}\n\n=== PDF TEXT (text.md) ===\n${text}\n\n=== MY HIGHLIGHTS (marks.md) ===\n${marks || '(none)'}`;
  if (p.handoff) { await p.run(full, { kind }); return; }

  const ac = new AbortController();
  const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Werkbank: ${p.label} is working …`, cancellable: true }, async (_pg, tok) => {
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
  const sel = await vscode.window.showQuickPick(items, { title: 'Choose the AI for Werkbank' });
  if (sel) await cfg().update('ai.provider', sel.id, vscode.ConfigurationTarget.Global);
}

async function setApiKey(ctx) {
  const v = await vscode.window.showInputBox({ title: 'API key (stored securely in the VS Code keychain)', password: true, ignoreFocusOut: true, prompt: 'Leave empty and confirm to delete the key. Ollama does not need one.' });
  if (v === undefined) return;
  if (v) { await ctx.secrets.store(SECRET_KEY, v); vscode.window.showInformationMessage('Key saved.'); }
  else { await ctx.secrets.delete(SECRET_KEY); vscode.window.showInformationMessage('Key deleted.'); }
}

/** Name and icon of the selected AI for the UI. */
function describe() {
  const id = cfg().get('ai.provider') || 'claude-code', p = providers.get(id);
  let name = (p && (p.shortName || p.label)) || id, icon = (p && p.icon) || null;
  if (id === 'openai') {
    const ep = String(cfg().get('ai.endpoint') || ''), model = String(cfg().get('ai.model') || '');
    name = /generativelanguage|gemini/i.test(ep + model) ? 'Gemini' : /11434|ollama/i.test(ep) ? 'Ollama' : /openai\.com/i.test(ep) ? 'OpenAI' : /anthropic/i.test(ep) ? 'Claude' : /openrouter/i.test(ep) ? 'OpenRouter' : /localhost|127\.0\.0\.1|1234/.test(ep) ? 'Local AI' : (model || 'KI');
  }
  return { id, name, icon };
}

module.exports = { describe, registerProvider, registerBuiltins, runTask, pickProvider, setApiKey, providers };
