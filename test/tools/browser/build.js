const body=require('/home/claude/lernmodus-vscode/template.js');
const cfg={pdfUri:'http://localhost:8765/testdata/sample.pdf',mediaUri:'http://localhost:8765/lernmodus-vscode/media',name:'sample.pdf',relPdf:'sample.pdf',dataFolder:'_lernmodus'};
const mock=`<script>window.__msgs=[];
const toB=b=>{let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(s)};
window.acquireVsCodeApi=()=>({postMessage:async m=>{window.__msgs.push(m);const r=x=>setTimeout(()=>postMessage({type:'reply',rid:m.rid,...x},'*'),20);
 if(m.type==='ready')setTimeout(()=>postMessage({type:'init',ann:{},hasText:false},'*'),50);
 else if(m.type==='pickPdfs'){const b=new Uint8Array(await (await fetch('${cfg.pdfUri}')).arrayBuffer());r({files:[{name:'zweite.pdf',b64:toB(b)}]})}
 else if(m.type==='redact'){const rr=await fetch('http://localhost:9912/redact',{method:'POST',body:JSON.stringify({b64:m.b64,boxes:m.boxes})});r(await rr.json())}
 else if(m.type==='confirmOverwrite')r({ok:true});
 else if(m.type==='saveFile'||m.type==='saveAs')r({ok:true,name:'x.pdf'});
 else if(m.type==='saveMany')r({ok:true,names:m.files.map(f=>f.name)});
}});</script>`;
require('fs').writeFileSync('/home/claude/lernmodus-vscode/harness.html',`<!doctype html><html><head><meta charset=utf-8>${mock}<link rel="stylesheet" href="media/lib/textlayer.css"><link rel="stylesheet" href="media/main.css"></head><body><div id="cfg" data-cfg='${JSON.stringify(cfg)}'></div>${body}<script type="module" src="media/main.js"></script></body></html>`);
