import fs from 'node:fs';
import { ocrPdf } from '/home/claude/lernmodus-vscode/mcp/ocr.mjs';
for (const [name,opt] of [['fast200',{fast:true,dpi:200}],['fast250',{fast:true,dpi:250}],['fast300',{fast:true,dpi:300}],['good300',{}]]) {
  const t=Date.now(); const r=await ocrPdf(new Uint8Array(fs.readFileSync(process.argv[2])),opt);
  console.log(name, JSON.stringify(r.pages.map(p=>[p.words,p.conf])), ((Date.now()-t)/1000).toFixed(1)+'s');
  fs.writeFileSync('/tmp/ocr/t/f_'+name+'.pdf', r.bytes);
}
