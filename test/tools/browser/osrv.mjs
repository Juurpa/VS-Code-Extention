import http from 'http';
import * as o from '/home/claude/lernmodus-vscode/mcp/ocr.mjs';
http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
 if(req.method==='OPTIONS'){res.end();return;}
 let s='';for await(const c of req)s+=c;const m=JSON.parse(s);
 try{
  const bytes=new Uint8Array(Buffer.from(m.b64,'base64'));
  if(req.url==='/scan'){res.end(JSON.stringify({ok:true,pages:await o.detectScanned(bytes)}));return;}
  const r=await o.ocrPdf(bytes,{pages:m.pages,langs:m.langs,fast:m.fast,force:m.force});
  res.end(JSON.stringify({ok:true,b64:r.bytes?Buffer.from(r.bytes).toString('base64'):null,pages:r.pages,message:r.message}));
 }catch(e){res.end(JSON.stringify({ok:false,error:String(e.message)}));}
}).listen(9913);
