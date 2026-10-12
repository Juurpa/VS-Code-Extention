'use strict';
const vscode = require('vscode');
const os = require('os');
const path = require('path');
const R = require('./report');

const errors = []; // ring buffer of the latest error messages (text only, no content)
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
  let mcp = 'no';
  try {
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (ws) { const b = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ws.uri, '.mcp.json')); mcp = /"werkbank"/.test(Buffer.from(b).toString('utf8')) ? 'set up' : 'no'; }
  } catch (e) { /* no file */ }
  return {
    items: [
      ['Werkbank', (ctx.extension.packageJSON || {}).version],
      ['VS Code', `${vscode.version} (${vscode.env.appName})`],
      ['System', `${process.platform} ${process.arch}, ${os.release()}`],
      ['Language', vscode.env.language],
      ['AI provider', c.get('ai.provider') || '–'],
      ['AI tools (MCP)', mcp]
    ],
    errors: errors.slice(),
    pdf: pdf || null
  };
}

/** Opens the dialog. opt: { type, title, what, pdf } */
async function open(ctx, opt = {}) {
  const diag = await collect(ctx, opt.pdf);
  const dest = target(ctx);
  const panel = vscode.window.createWebviewPanel('werkbank.feedback', opt.type === 'bug' || !opt.type ? 'Report a Problem' : 'Give Feedback', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
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
        if (m.kind === 'copy') { await vscode.env.clipboard.writeText(full); vscode.window.showInformationMessage('Report copied.'); }
        else if (m.kind === 'file') {
          const wsd = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
          const def = vscode.Uri.file(path.join(wsd ? wsd.uri.fsPath : os.homedir(), 'werkbank-report.md'));
          const out = await vscode.window.showSaveDialog({ defaultUri: def, filters: { Markdown: ['md'] } });
          if (out) { await vscode.workspace.fs.writeFile(out, Buffer.from(full, 'utf8')); vscode.window.showInformationMessage('Report saved: ' + path.basename(out.fsPath)); }
        } else if (m.kind === 'github') {
          const g = R.githubUrl(dest.repo, f, body);
          if (!g) { vscode.window.showWarningMessage('No GitHub address for reports has been configured yet (setting werkbank.feedback.githubRepo).'); return; }
          if (g.cut) await vscode.env.clipboard.writeText(full);
          await vscode.env.openExternal(vscode.Uri.parse(g.url));
          vscode.window.showInformationMessage(g.cut ? 'GitHub is open. The report was too long for the link: the full text is in your clipboard, please paste it there. Nothing is sent until you click “Submit” on GitHub.' : 'GitHub is open. Nothing is sent until you click “Submit new issue” there.');
        } else if (m.kind === 'email') {
          const e = R.mailtoUrl(dest.email, f, body);
          if (!e) { vscode.window.showWarningMessage('No email address for reports has been configured yet (setting werkbank.feedback.email).'); return; }
          await vscode.env.clipboard.writeText(full);
          await vscode.env.openExternal(vscode.Uri.parse(e.url));
          vscode.window.showInformationMessage('Your email app is open. The full report is also in your clipboard. Nothing is sent until you click “Send” in the email.');
        }
      } else if (m.type === 'close') panel.dispose();
    } catch (e) { record('feedback', e); vscode.window.showErrorMessage('Werkbank: ' + (e.message || e)); }
  });
}

function html(n, csp) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
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
<h2 id="h">Report a Problem</h2>
<p class="sub">Your report helps improve Werkbank in the next update. Nothing is sent automatically.</p>
<label for="type">Type of report</label>
<select id="type"><option value="bug">Bug</option><option value="wish">Request / Idea</option><option value="praise">Praise / General</option></select>
<label for="title">Short title</label><input type="text" id="title" maxlength="100" placeholder="e.g. Redaction fails on page 3">
<label for="what" id="whatL">What happened?</label><textarea id="what"></textarea>
<div id="bugOnly">
<label for="expected">What did you expect? <span class="opt">(optional)</span></label><textarea id="expected" style="min-height:48px"></textarea>
<label for="steps">Steps to reproduce <span class="opt">(optional)</span></label><textarea id="steps" style="min-height:60px" placeholder="1. Open a PDF&#10;2. Tools → Redact&#10;3. …"></textarea>
</div>
<label for="contact">Contact for questions <span class="opt">(optional, e.g. email)</span></label><input type="text" id="contact">
<div id="hints" class="warn" hidden></div>
<label>What should be included?</label>
<label class="chk"><input type="checkbox" id="withSystem" checked><span>System data: Werkbank, VS Code and operating system version, AI provider (no key)</span></label>
<label class="chk" id="errRow"><input type="checkbox" id="withErrors" checked><span>Recent Werkbank error messages (paths and names are masked)</span></label>
<label class="chk" id="pdfRow"><input type="checkbox" id="withPdf"><span>Details about the open PDF: page count, size, creator application. Never content or file name.</span></label>
<div class="note">Document contents, file names and your highlights are <b>never</b> included. A report on GitHub is public: do not enter any private data here. You can add screenshots there; check beforehand that nothing private is visible.</div>
<label>Preview: exactly this will be sent</label><pre id="prev"></pre>
<div class="row">
<button class="p" id="github">Report on GitHub</button>
<button class="p" id="email">Send by email</button>
<button id="file">Save as file</button>
<button id="copy">Copy</button>
</div>
<p id="nodest" class="sub" hidden>No recipient has been configured for this version yet. Copy the report or save it as a file and send it to the developer.</p>
<script nonce="${n}">
const vs=acquireVsCodeApi(),$=(i)=>document.getElementById(i);
const F=()=>({type:$('type').value,title:$('title').value,what:$('what').value,expected:$('expected').value,steps:$('steps').value,contact:$('contact').value,withSystem:$('withSystem').checked,withErrors:$('withErrors').checked,withPdf:$('withPdf').checked});
let t;const ask=()=>{clearTimeout(t);t=setTimeout(()=>{vs.postMessage({type:'preview',form:F()});upd();},150)};
function upd(){const f=F(),bug=f.type==='bug';$('bugOnly').hidden=!bug;$('whatL').textContent=bug?'What happened?':'Description';
 $('h').textContent=bug?'Report a Problem':f.type==='wish'?'Request or Idea':'Give Feedback';
 const ok=f.title.trim().length>2&&f.what.trim().length>4;['github','email','file','copy'].forEach(k=>{if(!$(k).dataset.na)$(k).disabled=!ok});}
['type','title','what','expected','steps','contact','withSystem','withErrors','withPdf'].forEach(i=>{$(i).addEventListener('input',ask);$(i).addEventListener('change',ask)});
['github','email','file','copy'].forEach(k=>$(k).onclick=()=>vs.postMessage({type:'act',kind:k,form:F()}));
window.addEventListener('message',e=>{const m=e.data;
 if(m.type==='init'){$('type').value=m.preset.type;$('title').value=m.preset.title;$('what').value=m.preset.what;
  [['github',m.dest.github],['email',m.dest.email]].forEach(([k,v])=>{if(!v){$(k).hidden=true;$(k).dataset.na='1'}});
  $('nodest').hidden=m.dest.github||m.dest.email;$('pdfRow').hidden=!m.hasPdf;$('errRow').hidden=!m.hasErrors;if(!m.hasErrors)$('withErrors').checked=false;ask();}
 else if(m.type==='preview'){$('prev').textContent=m.text;const h=$('hints');h.hidden=!m.hints.length;
  h.textContent=m.hints.length?'Your text probably contains private details ('+m.hints.join(', ')+'). Please remove them before sending.':'';}});
vs.postMessage({type:'ready'});
</script></body></html>`;
}

module.exports = { open, record, collect, target };
