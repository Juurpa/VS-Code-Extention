import fs from 'fs';
import {execSync} from 'child_process';
import * as o from '/home/claude/lernmodus-vscode/mcp/ops.mjs';
const files=process.argv.slice(2);
for(const f of files){
  const bytes=new Uint8Array(fs.readFileSync(f));
  let r;try{r=await o.redactVerified(bytes,{terms:['Max Mustermann'],kinds:['iban','email']});}catch(e){console.log(f,'ERROR',e.message);continue;}
  const out=f.replace('.pdf','_red.pdf');
  if(!r.bytes){console.log(f,'nichts gefunden');continue;}
  fs.writeFileSync(out,r.bytes);
  const txt=execSync(`pdftotext "${out}" - 2>/dev/null || true`).toString();
  const q=execSync(`qpdf --check "${out}" 2>&1 | tail -n 1`).toString().trim();
  const leakTxt=/Mustermann|3704|example\.com/i.test(txt);
  console.log(f,'|',r.modes.map(m=>`S${m.page}:${m.mode.startsWith('Buch')?'vektor':'BILD('+(m.reason||'')+')'}`).join(' '),'| verify',r.verification.ok,r.verification.scrubbed.length?'scrubbed:'+r.verification.scrubbed:'','| pdftotext-leak',leakTxt,'| qpdf:',q.slice(0,40));
}
