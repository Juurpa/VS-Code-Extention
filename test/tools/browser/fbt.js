const {chromium}=require('playwright');const fs=require('fs');
(async()=>{
 const src=fs.readFileSync('/home/claude/lernmodus-vscode/feedback.js','utf8');
 const body=src.slice(src.indexOf('function html(n, csp) {'),src.indexOf('module.exports'));
 const html=new Function(body+';return html;')()('abc','x').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace('<script nonce="abc">','<script>window.__m=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__m.push(m)});');
 const b=await chromium.launch(),p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setContent(html);
 await p.evaluate(()=>window.postMessage({type:'init',preset:{type:'bug',title:'',what:''},dest:{github:true,email:false},hasPdf:true,hasErrors:true},'*'));
 await p.waitForTimeout(300);
 const dis0=await p.$eval('#github',e=>e.disabled);
 await p.fill('#title','Schwärzen bricht ab');await p.fill('#what','Seite 3 bleibt leer');await p.waitForTimeout(400);
 const dis1=await p.$eval('#github',e=>e.disabled);
 const emailHidden=await p.$eval('#email',e=>e.hidden);
 await p.evaluate(()=>window.postMessage({type:'preview',text:'## x',hints:['IBAN']},'*'));await p.waitForTimeout(100);
 const warn=await p.$eval('#hints',e=>!e.hidden&&e.textContent);
 await p.click('#github');
 const msgs=await p.evaluate(()=>window.__m.map(m=>m.type+(m.kind?':'+m.kind:'')));
 console.log({dis0,dis1,emailHidden,warn,msgs,errs});await b.close();
})();
