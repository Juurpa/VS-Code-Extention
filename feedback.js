'use strict';
const vscode = require('vscode');
const os = require('os');
const path = require('path');
const R = require('./report');

const errors = []; // Ringspeicher der letzten Fehlermeldungen (nur Text, keine Inhalte)
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function record(where, err) {
  let m = String(err && err.message || err || '').replace(/\s+/g, ' ').slice(0, 300);
  if (!m) return;
  errors.push({ t: stamp(), where, message: m });
  if (errors.length > 10) errors.shift();
}

const scrubOpt = () => ({ home: os.homedir(), roots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath) });

function target(ctx) {
  const c = vscode.workspace.getConfiguration('werkbank');
  const pj = ctx.extension.packageJSON || {};
  const repo = c.get('feedback.githubRepo') || (pj.bugs && (pj.bugs.url || pj.bugs)) || (pj.repository && (pj.repository.url || pj.repository)) || '';
  const email = c.get('feedback.email') || '';
  return { repo: R.githubUrl(repo, { type: 'bug' }, 'x') ? repo : '', email: /@/.test(email) ? email : '' };
}

async function collect(ctx, pdf) {
  const c = vscode.workspace.getConfiguration('werkbank');
  let mcp = 'nein';
  try {
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (ws) { const b = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ws.uri, '.mcp.json')); mcp = /"werkbank"/.test(Buffer.from(b).toString('utf8')) ? 'eingerichtet' : 'nein'; }
  } catch (e) { /* keine Datei */ }
  return {
    items: [
      ['Werkbank', (ctx.extension.packageJSON || {}).version],
      ['VS Code', `${vscode.version} (${vscode.env.appName})`],
      ['System', `${process.platform} ${process.arch}, ${os.release()}`],
      ['Sprache', vscode.env.language],
      ['KI-Anbieter', c.get('ai.provider') || '–'],
      ['KI-Werkzeuge (MCP)', mcp]
    ],
    errors: errors.slice(),
    pdf: pdf || null
  };
}

/** Öffnet den Dialog. opt: { type, title, what, pdf } */
async function open(ctx, opt = {}) {
  const diag = await collect(ctx, opt.pdf);
  const dest = target(ctx);
  const panel = vscode.window.createWebviewPanel('werkbank.feedback', opt.type === 'bug' || !opt.type ? 'Fehler melden' : 'Feedback geben', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  const n = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
  panel.webview.html = html(n, panel.webview.cspSource);
  const build = (form) => R.buildReport(form, diag, scrubOpt());
  panel.webview.onDidReceiveMessage(async (m) => {
    try {
      if (m.type === 'ready') {
        panel.webview.postMessage({ type: 'init', preset: { type: opt.type || 'bug', title: opt.title || '', what: opt.what || '' }, dest: { github: !!dest.repo, email: !!dest.email }, hasPdf: !!diag.pdf, hasErrors: diag.errors.length > 0 });
      } else if (m.type === 'preview') {
        const f = m.form, own = [f.title, f.what, f.expected, f.steps].join('\n');
        panel.webview.postMessage({ type: 'preview', text: build(f), hints: R.privacyHints(own) });
      } else if (m.type === 'act') {
        const f = m.form, body = build(f), full = `# ${R.titleOf(f)}\n\n${body}\n`;
        if (m.kind === 'copy') { await vscode.env.clipboard.writeText(full); vscode.window.showInformationMessage('Bericht kopiert.'); }
        else if (m.kind === 'file') {
          const wsd = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
          const def = vscode.Uri.file(path.join(wsd ? wsd.uri.fsPath : os.homedir(), 'werkbank-bericht.md'));
          const out = await vscode.window.showSaveDialog({ defaultUri: def, filters: { Markdown: ['md'] } });
          if (out) { await vscode.workspace.fs.writeFile(out, Buffer.from(full, 'utf8')); vscode.window.showInformationMessage('Bericht gespeichert: ' + path.basename(out.fsPath)); }
        } else if (m.kind === 'github') {
          const g = R.githubUrl(dest.repo, f, body);
          if (!g) { vscode.window.showWarningMessage('Es ist noch keine GitHub-Adresse für Meldungen hinterlegt (Einstellung werkbank.feedback.githubRepo).'); return; }
          if (g.cut) await vscode.env.clipboard.writeText(full);
          await vscode.env.openExternal(vscode.Uri.parse(g.url));
          vscode.window.showInformationMessage(g.cut ? 'GitHub ist offen. Der Bericht war zu lang für den Link: der vollständige Text liegt in der Zwischenablage, bitte dort einfügen. Gesendet wird erst, wenn du auf GitHub „Submit“ drückst.' : 'GitHub ist offen. Gesendet wird erst, wenn du dort „Submit new issue“ drückst.');
        } else if (m.kind === 'email') {
          const e = R.mailtoUrl(dest.email, f, body);
          if (!e) { vscode.window.showWarningMessage('Es ist noch keine E-Mail-Adresse für Meldungen hinterlegt (Einstellung werkbank.feedback.email).'); return; }
          await vscode.env.clipboard.writeText(full);
          await vscode.env.openExternal(vscode.Uri.parse(e.url));
          vscode.window.showInformationMessage('Dein Mailprogramm ist offen. Der vollständige Bericht liegt auch in der Zwischenablage. Gesendet wird erst, wenn du in der Mail auf „Senden“ drückst.');
        }
      } else if (m.type === 'close') panel.dispose();
    } catch (e) { record('feedback', e); vscode.window.showErrorMessage('Werkbank: ' + (e.message || e)); }
  });
}

function html(n, csp) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font:13px/1.45 var(--vscode-font-family);color:var(--vscode-foreground);padding:16px 20px;max-width:760px}
h2{margin:0 0 4px;font-weight:600} .sub{opacity:.75;margin:0 0 14px}
label{display:block;margin:12px 0 4px;font-weight:600} .opt{font-weight:400;opacity:.7}
input[type=text],textarea,select{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#8884);border-radius:4px;padding:6px 8px;font:inherit}
textarea{min-height:70px;resize:vertical}
.chk{display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-weight:400}.chk input{margin-top:3px}
.warn{background:var(--vscode-inputValidation-warningBackground);border:1px solid var(--vscode-inputValidation-warningBorder);border-radius:4px;padding:8px 10px;margin:10px 0}
.note{background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-textLink-foreground);padding:8px 10px;margin:10px 0}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;border-radius:4px;padding:7px 12px;cursor:pointer;font:inherit}
button.p{background:var(--vscode-button-background);color:var(--vscode-button-foreground)} button:disabled{opacity:.45;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:4px;max-height:260px;overflow:auto}
[hidden]{display:none!important}
</style></head><body>
<h2 id="h">Fehler melden</h2>
<p class="sub">Deine Meldung hilft, Werkbank im nächsten Update zu verbessern. Es wird nichts automatisch gesendet.</p>
<label for="type">Art der Meldung</label>
<select id="type"><option value="bug">Fehler</option><option value="wish">Wunsch / Idee</option><option value="praise">Lob / Allgemeines</option></select>
<label for="title">Kurzer Titel</label><input type="text" id="title" maxlength="100" placeholder="z. B. Schwärzen bricht bei Seite 3 ab">
<label for="what" id="whatL">Was ist passiert?</label><textarea id="what"></textarea>
<div id="bugOnly">
<label for="expected">Was hattest du erwartet? <span class="opt">(optional)</span></label><textarea id="expected" style="min-height:48px"></textarea>
<label for="steps">Schritte zum Nachstellen <span class="opt">(optional)</span></label><textarea id="steps" style="min-height:60px" placeholder="1. PDF öffnen&#10;2. Werkzeuge → Schwärzen&#10;3. …"></textarea>
</div>
<label for="contact">Kontakt für Rückfragen <span class="opt">(optional, z. B. E-Mail)</span></label><input type="text" id="contact">
<div id="hints" class="warn" hidden></div>
<label>Was soll mitgeschickt werden?</label>
<label class="chk"><input type="checkbox" id="withSystem" checked><span>Systemdaten: Werkbank-, VS-Code- und Windows-Version, KI-Anbieter (kein Schlüssel)</span></label>
<label class="chk" id="errRow"><input type="checkbox" id="withErrors" checked><span>Letzte Fehlermeldungen von Werkbank (Pfade und Namen werden unkenntlich gemacht)</span></label>
<label class="chk" id="pdfRow"><input type="checkbox" id="withPdf"><span>Angaben zur geöffneten PDF: Seitenzahl, Größe, Ersteller-Programm. Nie Inhalt oder Dateiname.</span></label>
<div class="note">Dokumentinhalte, Dateinamen und deine Markierungen werden <b>nie</b> mitgeschickt. Auf GitHub ist eine Meldung öffentlich: trage hier keine privaten Daten ein. Screenshots kannst du dort einfügen, prüfe vorher, dass nichts Privates zu sehen ist.</div>
<label>Vorschau: genau das wird gesendet</label><pre id="prev"></pre>
<div class="row">
<button class="p" id="github">Auf GitHub melden</button>
<button class="p" id="email">Per E-Mail senden</button>
<button id="file">Als Datei speichern</button>
<button id="copy">Kopieren</button>
</div>
<p id="nodest" class="sub" hidden>Für diese Version ist noch kein Empfänger hinterlegt. Kopiere den Bericht oder speichere ihn als Datei und schicke ihn dem Entwickler.</p>
<script nonce="${n}">
const vs=acquireVsCodeApi(),$=(i)=>document.getElementById(i);
const F=()=>({type:$('type').value,title:$('title').value,what:$('what').value,expected:$('expected').value,steps:$('steps').value,contact:$('contact').value,withSystem:$('withSystem').checked,withErrors:$('withErrors').checked,withPdf:$('withPdf').checked});
let t;const ask=()=>{clearTimeout(t);t=setTimeout(()=>{vs.postMessage({type:'preview',form:F()});upd();},150)};
function upd(){const f=F(),bug=f.type==='bug';$('bugOnly').hidden=!bug;$('whatL').textContent=bug?'Was ist passiert?':'Beschreibung';
 $('h').textContent=bug?'Fehler melden':f.type==='wish'?'Wunsch oder Idee':'Feedback geben';
 const ok=f.title.trim().length>2&&f.what.trim().length>4;['github','email','file','copy'].forEach(k=>{if(!$(k).dataset.na)$(k).disabled=!ok});}
['type','title','what','expected','steps','contact','withSystem','withErrors','withPdf'].forEach(i=>{$(i).addEventListener('input',ask);$(i).addEventListener('change',ask)});
['github','email','file','copy'].forEach(k=>$(k).onclick=()=>vs.postMessage({type:'act',kind:k,form:F()}));
window.addEventListener('message',e=>{const m=e.data;
 if(m.type==='init'){$('type').value=m.preset.type;$('title').value=m.preset.title;$('what').value=m.preset.what;
  [['github',m.dest.github],['email',m.dest.email]].forEach(([k,v])=>{if(!v){$(k).hidden=true;$(k).dataset.na='1'}});
  $('nodest').hidden=m.dest.github||m.dest.email;$('pdfRow').hidden=!m.hasPdf;$('errRow').hidden=!m.hasErrors;if(!m.hasErrors)$('withErrors').checked=false;ask();}
 else if(m.type==='preview'){$('prev').textContent=m.text;const h=$('hints');h.hidden=!m.hints.length;
  h.textContent=m.hints.length?'Dein Text enthält vermutlich private Angaben ('+m.hints.join(', ')+'). Bitte entfernen, bevor du sendest.':'';}});
vs.postMessage({type:'ready'});
</script></body></html>`;
}

module.exports = { open, record, collect, target };
