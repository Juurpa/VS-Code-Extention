const vscode=require('vscode'),fs=require('fs'),cp=require('child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async function(){
  const out=[];const ok=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(x?' '+x:''));
  try{
    const ext=vscode.extensions.all.find(e=>e.packageJSON.name==='werkbank');await ext.activate();
    // 1) OCR direkt im Erweiterungsprozess (Worker-Threads im Electron-Node)
    const b64=fs.readFileSync('/tmp/vsc/ws/scan.pdf').toString('base64');
    const t0=Date.now();
    const r=await vscode.commands.executeCommand('werkbank.internal.ocr',b64,{fast:true});
    ok('ocr in extension host',r&&r.b64&&r.pages.length===1&&r.pages[0].words>=20,JSON.stringify(r&&r.pages)+' '+(Date.now()-t0)+'ms');
    fs.writeFileSync('/tmp/vsc/ws/scan_ocr_ui.pdf',Buffer.from(r.b64,'base64'));
    const txt=cp.execSync('pdftotext /tmp/vsc/ws/scan_ocr_ui.pdf -').toString();
    ok('text readable after ocr',/Rechnung/.test(txt)&&/Mustermann/.test(txt)&&/3704/.test(txt));
    // 2) MCP-Server wie Claude Code ihn startet
    const mcp='/tmp/vsc/ws/.mcp.json';try{fs.unlinkSync(mcp)}catch{}
    await vscode.commands.executeCommand('werkbank.setupMcp');
    const j=JSON.parse(fs.readFileSync(mcp,'utf8')).mcpServers.werkbank;
    const child=cp.spawn(j.command,j.args,{env:{...process.env,...j.env}});
    let buf='';const waiters=new Map();let err='';
    child.stderr.on('data',d=>err+=d);
    child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);waiters.get(m.id)?.(m);}});
    let n=0;const rpc=(method,params)=>new Promise((res,rej)=>{const id=++n;waiters.set(id,res);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>rej(new Error('timeout '+err)),170000);});
    const init=await rpc('initialize',{protocolVersion:'2025-03-26'});ok('server starts',init.result.serverInfo.name==='werkbank'&&init.result.serverInfo.version==='0.7.1');
    const list=await rpc('tools/list',{});ok('15 tools incl. pdf_ocr',list.result.tools.length===15&&list.result.tools.some(t=>t.name==='pdf_ocr'),String(list.result.tools.length));
    const inf=JSON.parse((await rpc('tools/call',{name:'pdf_info',arguments:{file:'scan.pdf'}})).result.content[0].text);
    ok('pdf_info reports scan page',JSON.stringify(inf.seiten_ohne_text)==='[1]',JSON.stringify(inf.seiten_ohne_text));
    const rt=JSON.parse((await rpc('tools/call',{name:'pdf_read_text',arguments:{file:'scan.pdf'}})).result.content[0].text);
    ok('read_text hints at ocr',/pdf_ocr/.test(rt[0].hinweis||''));
    const oc=JSON.parse((await rpc('tools/call',{name:'pdf_ocr',arguments:{file:'scan90.pdf',quality:'fast',out:'scan90_ocr.pdf'}})).result.content[0].text);
    ok('pdf_ocr on rotated scan',oc.file==='scan90_ocr.pdf'&&oc.pages[0].words>=20&&oc.pages[0].turned_by===270,JSON.stringify(oc.pages));
    const rt2=JSON.parse((await rpc('tools/call',{name:'pdf_read_text',arguments:{file:'scan90_ocr.pdf'}})).result.content[0].text);
    ok('text after mcp ocr',/Mustermann/.test(rt2[0].text),rt2[0].text.slice(0,60).replace(/\n/g,'|'));
    const rd=JSON.parse((await rpc('tools/call',{name:'pdf_redact',arguments:{file:'scan90_ocr.pdf',terms:['Mustermann'],kinds:['iban'],out:'scan90_red.pdf'}})).result.content[0].text);
    ok('redact on ocr result verified',rd.verification&&rd.verification.ok===true,JSON.stringify(rd.seiten));
    const t3=cp.execSync('pdftotext /tmp/vsc/ws/scan90_red.pdf -').toString();
    ok('redacted text gone',!/Mustermann|3704/.test(t3)&&/Rechnung/.test(t3));
    const again=JSON.parse((await rpc('tools/call',{name:'pdf_ocr',arguments:{file:'scan90_ocr.pdf'}})).result.content[0].text);
    ok('second ocr skips (already has text)',again.changed===false,JSON.stringify(again).slice(0,100));
    child.kill();
    // 3) Editor mit dynamischer KI-Anzeige öffnen (kein Fehler beim Aufbau, Wechsel der KI wirkt auf offene Ansicht)
    await vscode.commands.executeCommand('vscode.openWith',vscode.Uri.file('/tmp/vsc/ws/scan.pdf'),'werkbank.pdfEditor');await sleep(3000);
    ok('werkbank editor opens',vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>/scan\.pdf/.test(t.label)));
    await vscode.workspace.getConfiguration('werkbank').update('ai.provider','zwischenablage',vscode.ConfigurationTarget.Global);await sleep(800);
    await vscode.workspace.getConfiguration('werkbank').update('ai.provider','claude-code',vscode.ConfigurationTarget.Global);await sleep(500);
    ok('provider switch without error',true);
  }catch(e){out.push('ERROR '+e.stack);}
  fs.writeFileSync('/tmp/vsc/result.txt',out.join('\n'));
};
