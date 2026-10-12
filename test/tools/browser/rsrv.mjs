import http from 'http';
import * as o from '/home/claude/lernmodus-vscode/mcp/ops.mjs';
http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
 if(req.method==='OPTIONS'){res.end();return;}
 let s='';for await(const c of req)s+=c;const {b64,boxes}=JSON.parse(s);
 try{const r=await o.redactVerified(new Uint8Array(Buffer.from(b64,'base64')),{boxes});
  res.end(JSON.stringify({ok:true,b64:Buffer.from(r.bytes).toString('base64'),verification:r.verification,pages:r.pagesChanged,modes:r.modes}));}
 catch(e){res.end(JSON.stringify({ok:false,error:String(e.message)}));}
}).listen(9912);
