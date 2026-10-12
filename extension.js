'use strict';
const vscode = require('vscode');
const path = require('path');
const sc = require('./sidecar');
const ai = require('./ai');
const fb = require('./feedback');

const cfg = () => vscode.workspace.getConfiguration('werkbank');
const enc = (s) => Buffer.from(s, 'utf8');
const dec = (b) => Buffer.from(b).toString('utf8');

async function exists(uri) { try { await vscode.workspace.fs.stat(uri); return true; } catch (e) { return false; } }
async function writeFile(uri, content) {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, typeof content === 'string' ? enc(content) : content);
}

function nonce() { let t = ''; const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 32; i++) t += c[Math.floor(Math.random() * c.length)]; return t; }

const ocrJobs = new Map();
const panels = new Set(); // open Werkbank views, so that switching the AI shows up everywhere immediately

function aiInfo(webview, mediaUri) {
  const d = ai.describe();
  let icon = d.icon;
  if (icon && !/^data:/.test(icon)) icon = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, ...String(icon).split('/'))).toString();
  return { id: d.id, name: d.name, icon: icon || null };
}

class PdfEditorProvider {
  constructor(ctx) { this.ctx = ctx; }
  openCustomDocument(uri) { return { uri, dispose() {} }; }

  async resolveCustomEditor(document, panel) {
    const uri = document.uri;
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    const baseUri = ws ? ws.uri : vscode.Uri.file(path.dirname(uri.fsPath));
    const relPdf = sc.toPosix(path.relative(baseUri.fsPath, uri.fsPath));
    const dataFolder = cfg().get('dataFolder') || '_werkbank';
    const dirRel = sc.dataDirRel(dataFolder, relPdf);
    const dirUri = vscode.Uri.joinPath(baseUri, ...dirRel.split('/'));
    const annUri = vscode.Uri.joinPath(dirUri, 'annotations.json');
    const marksUri = vscode.Uri.joinPath(dirUri, 'marks.md');
    const textUri = vscode.Uri.joinPath(dirUri, 'text.md');
    const mediaUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');

    const roots = [mediaUri, vscode.Uri.file(path.dirname(uri.fsPath))];
    if (ws) roots.push(ws.uri);
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = this.html(panel.webview, mediaUri, {
      pdfUri: panel.webview.asWebviewUri(uri).toString(),
      mediaUri: panel.webview.asWebviewUri(mediaUri).toString(),
      name: path.basename(uri.fsPath), relPdf, dataFolder
    });

    const send = (m) => panel.webview.postMessage(m);
    const entry = { push: () => send({ type: 'ai', ai: aiInfo(panel.webview, mediaUri) }) };
    panels.add(entry); panel.onDidDispose(() => panels.delete(entry));
    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready': {
            let ann = {};
            if (await exists(annUri)) { try { ann = JSON.parse(dec(await vscode.workspace.fs.readFile(annUri))); } catch (e) { /* corrupt */ } }
            let hasText = false;
            if (await exists(textUri)) {
              const [a, b] = await Promise.all([vscode.workspace.fs.stat(textUri), vscode.workspace.fs.stat(uri)]);
              hasText = a.mtime >= b.mtime;
            }
            send({ type: 'init', ann, hasText, sig: this.ctx.globalState.get('werkbank.sig') || null, ai: aiInfo(panel.webview, mediaUri) });
            break;
          }
          case 'saveAnn':
            await writeFile(annUri, JSON.stringify(msg.ann));
            await writeFile(marksUri, sc.buildMarksMd({ relPdf, ann: msg.ann }));
            break;
          case 'saveText':
            await writeFile(textUri, sc.buildTextMd({ relPdf, texts: msg.texts }));
            break;
          case 'saveCopy': {
            const out = vscode.Uri.file(uri.fsPath.replace(/\.pdf$/i, '') + '_marked.pdf');
            await writeFile(out, Buffer.from(msg.b64, 'base64'));
            vscode.window.showInformationMessage('Saved: ' + path.basename(out.fsPath), 'Open').then((c) => { if (c) vscode.commands.executeCommand('vscode.open', out); });
            break;
          }
          case 'openMarks':
            if (await exists(marksUri)) await vscode.commands.executeCommand('vscode.open', marksUri, { viewColumn: vscode.ViewColumn.Beside });
            else vscode.window.showInformationMessage('No highlights yet.');
            break;
          case 'claude': {
            if (!(await exists(textUri))) vscode.window.showInformationMessage('Note: The PDF text is still being stored. If the AI cannot find it, try again in a moment.');
            await ai.runTask(this.ctx, msg.kind, { relPdf, dataFolder, page: msg.page, selection: msg.selection, count: msg.count, dirUri, textUri, marksUri });
            break;
          }
          case 'saveSig': await this.ctx.globalState.update('werkbank.sig', msg.png); break;
          case 'pickPdfs': {
            const picked = await vscode.window.showOpenDialog({ canSelectMany: !!msg.multi, filters: { PDF: ['pdf'] }, defaultUri: vscode.Uri.file(path.dirname(uri.fsPath)), openLabel: 'Select' });
            const files = [];
            for (const u of picked || []) files.push({ name: path.basename(u.fsPath), b64: Buffer.from(await vscode.workspace.fs.readFile(u)).toString('base64') });
            send({ type: 'reply', rid: msg.rid, files });
            break;
          }
          case 'redact': {
            try {
              const r = await redactBytes(this.ctx, Buffer.from(msg.b64, 'base64'), msg.boxes);
              send({ type: 'reply', rid: msg.rid, ok: true, b64: Buffer.from(r.bytes).toString('base64'), verification: r.verification, pages: r.pages, modes: r.modes });
            } catch (err) { send({ type: 'reply', rid: msg.rid, ok: false, error: String(err && err.message || err) }); }
            break;
          }
          case 'ocrScan': {
            try { const mod = await import(vscode.Uri.joinPath(this.ctx.extensionUri, 'mcp', 'ocr.mjs').toString()); const pages = await mod.detectScanned(new Uint8Array(Buffer.from(msg.b64, 'base64'))); send({ type: 'reply', rid: msg.rid, ok: true, pages }); }
            catch (err) { fb.record('OCR check', err); send({ type: 'reply', rid: msg.rid, ok: false, error: String(err && err.message || err) }); }
            break;
          }
          case 'ocr': {
            const ac = new AbortController(); ocrJobs.set(msg.rid, ac);
            try {
              const mod = await import(vscode.Uri.joinPath(this.ctx.extensionUri, 'mcp', 'ocr.mjs').toString());
              const r = await mod.ocrPdf(new Uint8Array(Buffer.from(msg.b64, 'base64')), { pages: msg.pages, langs: msg.langs, fast: !!msg.fast, force: !!msg.force, signal: ac.signal, onProgress: (p) => send({ type: 'progress', rid: msg.rid, ...p }) });
              send({ type: 'reply', rid: msg.rid, ok: true, b64: r.bytes ? Buffer.from(r.bytes).toString('base64') : null, pages: r.pages, skipped: r.skipped, message: r.message });
            } catch (err) { if (!ac.signal.aborted) fb.record('OCR', err); send({ type: 'reply', rid: msg.rid, ok: false, error: ac.signal.aborted ? 'Cancelled.' : String(err && err.message || err) }); }
            finally { ocrJobs.delete(msg.rid); }
            break;
          }
          case 'ocrCancel': ocrJobs.get(msg.rid)?.abort(); break;
          case 'confirmOverwrite': {
            const c = await vscode.window.showWarningMessage(`Overwrite “${msg.name}” with the changes? Use “Save As” to keep the original.`, { modal: true }, 'Overwrite');
            send({ type: 'reply', rid: msg.rid, ok: c === 'Overwrite' });
            break;
          }
          case 'saveFile':
            await writeFile(uri, Buffer.from(msg.b64, 'base64'));
            send({ type: 'reply', rid: msg.rid, ok: true });
            break;
          case 'saveAs': {
            const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), msg.suggested || 'new.pdf')), filters: { PDF: ['pdf'] } });
            if (!target) { send({ type: 'reply', rid: msg.rid, ok: false }); break; }
            await writeFile(target, Buffer.from(msg.b64, 'base64'));
            send({ type: 'reply', rid: msg.rid, ok: true, name: path.basename(target.fsPath) });
            break;
          }
          case 'saveMany': {
            const names = [];
            for (const f of msg.files) {
              let name = f.name.replace(/[\\/:*?"<>|]/g, '_'), target = vscode.Uri.file(path.join(path.dirname(uri.fsPath), name)), k = 1;
              while (await exists(target)) { name = f.name.replace(/\.pdf$/i, '') + ` (${++k}).pdf`; target = vscode.Uri.file(path.join(path.dirname(uri.fsPath), name)); }
              await writeFile(target, Buffer.from(f.b64, 'base64')); names.push(name);
            }
            send({ type: 'reply', rid: msg.rid, ok: true, names });
            break;
          }
          case 'licenses': vscode.commands.executeCommand('werkbank.showLicenses'); break;
          case 'chooseAi': vscode.commands.executeCommand('werkbank.chooseAi'); break;
          case 'setupMcp': vscode.commands.executeCommand('werkbank.setupMcp'); break;
          case 'info': vscode.window.showInformationMessage(String(msg.text)); break;
          case 'jsError': fb.record('View', msg.message); break;
          case 'report': fb.open(this.ctx, { type: msg.kind || 'bug', title: msg.title, what: msg.what, pdf: msg.pdf }); break;
        }
      } catch (e) {
        if (e && e.code === 'CONFIG') { // missing setting: not a program error, so no report button
          vscode.window.showWarningMessage('Werkbank: ' + e.message, 'Open Settings', 'Choose Another AI').then((c) => { if (c === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'werkbank.ai'); else if (c) vscode.commands.executeCommand('werkbank.chooseAi'); });
          return;
        }
        fb.record('Extension', e);
        vscode.window.showErrorMessage('Werkbank: ' + (e.message || e), 'Report Problem').then((c) => { if (c) fb.open(this.ctx, { type: 'bug', what: String(e.message || e) }); });
      }
    });
  }

  html(webview, mediaUri, config) {
    const n = nonce();
    const csp = webview.cspSource;
    const m = (f) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, f));
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${n}' ${csp} 'wasm-unsafe-eval'; worker-src blob:; font-src ${csp} data:; connect-src ${csp} blob: data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${m('lib/textlayer.css')}"><link rel="stylesheet" href="${m('main.css')}">
</head><body>
<div id="cfg" hidden data-cfg='${JSON.stringify(config).replace(/'/g, '&#39;')}'></div>
${require('./template')}
<script type="module" nonce="${n}" src="${m('main.js')}"></script>
</body></html>`;
  }
}

/** Real redaction via the shared engine (the same one as in the AI tool server). */
async function redactBytes(ctx, bytes, boxes) {
  const mod = await import(vscode.Uri.joinPath(ctx.extensionUri, 'mcp', 'ops.mjs').toString());
  const r = await mod.redactVerified(new Uint8Array(bytes), { boxes });
  if (!r.bytes) throw new Error('Nothing was redacted.');
  return { bytes: r.bytes, pages: r.pagesChanged, modes: r.modes, verification: r.verification };
}

function activate(ctx) {
  ai.registerBuiltins(ctx);
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('werkbank.ai')) panels.forEach((p) => p.push()); }));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.chooseAi', ai.pickProvider));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.setApiKey', () => ai.setApiKey(ctx)));
  ctx.subscriptions.push(vscode.window.registerCustomEditorProvider('werkbank.pdfEditor', new PdfEditorProvider(ctx), {
    webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.setupClaudeMd', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showWarningMessage('Open a folder first (File → Open Folder).'); return; }
    const uri = vscode.Uri.joinPath(ws.uri, 'CLAUDE.md');
    let cur = '';
    if (await exists(uri)) cur = dec(await vscode.workspace.fs.readFile(uri));
    if (cur.includes(sc.CLAUDE_MD_MARK)) { vscode.window.showInformationMessage('The note is already in CLAUDE.md.'); return; }
    await writeFile(uri, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + (cur ? '\n' : '') + sc.claudeMdSnippet(cfg().get('dataFolder') || '_werkbank'));
    vscode.window.showInformationMessage('CLAUDE.md updated. Claude Code will now read the text and highlights of your PDFs first.');
    vscode.commands.executeCommand('vscode.open', uri);
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.setupMcp', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showWarningMessage('Open a folder first (File → Open Folder).'); return; }
    const uri = vscode.Uri.joinPath(ws.uri, '.mcp.json');
    let json = {};
    if (await exists(uri)) {
      try { json = JSON.parse(dec(await vscode.workspace.fs.readFile(uri)) || '{}'); }
      catch (e) { vscode.window.showErrorMessage('.mcp.json is not valid JSON. Please fix it first; nothing was overwritten.'); return; }
    }
    json.mcpServers = json.mcpServers || {};
    // VS Code ships its own Node runtime, so Node does not have to be installed on the machine.
    json.mcpServers.werkbank = {
      command: process.execPath,
      args: [vscode.Uri.joinPath(ctx.extensionUri, 'mcp', 'server.mjs').fsPath],
      env: { ELECTRON_RUN_AS_NODE: '1', WERKBANK_ROOT: ws.uri.fsPath, WERKBANK_DATA: cfg().get('dataFolder') || '_werkbank' }
    };
    await writeFile(uri, Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf8'));
    vscode.window.showInformationMessage('PDF tools for the AI are set up (.mcp.json). In Claude Code, approve the “werkbank” server once (command /mcp). Run this command again after a Werkbank update.', 'Open File').then((pick) => { if (pick) vscode.commands.executeCommand('vscode.open', uri); });
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.internal.redact', (b64, boxes) => redactBytes(ctx, Buffer.from(b64, 'base64'), boxes).then((r) => ({ ...r, bytes: Buffer.from(r.bytes).toString('base64') }))));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.reportProblem', (o) => fb.open(ctx, { type: 'bug', ...(o && typeof o === 'object' ? o : {}) })));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.sendFeedback', () => fb.open(ctx, { type: 'praise' })));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.internal.report', async (form, extra) => {
    const R = require('./report'), d = await fb.collect(ctx, extra && extra.pdf);
    const g = R.githubUrl('https://github.com/test/werkbank', form, R.buildReport(form, d, { home: require('os').homedir(), roots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath) }));
    return { body: R.buildReport(form, d, { home: require('os').homedir(), roots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath) }), url: g && g.url, target: fb.target(ctx) };
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.internal.ocr', async (b64, o) => {
    const mod = await import(vscode.Uri.joinPath(ctx.extensionUri, 'mcp', 'ocr.mjs').toString());
    const r = await mod.ocrPdf(new Uint8Array(Buffer.from(b64, 'base64')), o || {});
    return { b64: r.bytes ? Buffer.from(r.bytes).toString('base64') : null, pages: r.pages, skipped: r.skipped };
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.internal.record', (w, m) => fb.record(w, m)));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.showLicenses', () => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(ctx.extensionUri, 'THIRD_PARTY_LICENSES.md'))));
  ctx.subscriptions.push(vscode.commands.registerCommand('werkbank.revealData', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return;
    const uri = vscode.Uri.joinPath(ws.uri, cfg().get('dataFolder') || '_werkbank');
    if (await exists(uri)) vscode.commands.executeCommand('revealInExplorer', uri);
    else vscode.window.showInformationMessage('No Werkbank data yet. Open a PDF and highlight something.');
  }));
  return { registerProvider: ai.registerProvider };
}
function deactivate() {}

module.exports = { activate, deactivate };
