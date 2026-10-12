const {chromium}=require('/tmp/npmwork/node_modules/playwright-core');
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1300,height:500}});
const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('http://localhost:8765/lernmodus-vscode/harness3.html');
await p.waitForSelector('.page canvas',{timeout:15000});await p.waitForTimeout(1200);
console.log('btn:',await p.textContent('#tClaude'),'img:',await p.$$eval('#tClaude img',e=>e.length));
await p.click('#tClaude');await p.waitForTimeout(200);
console.log('menu:',(await p.$$eval('#menuPop .mi',e=>e.map(x=>x.textContent))).join(' | '));
await p.screenshot({path:'/tmp/h/ai1.png',clip:{x:700,y:0,width:600,height:380}});
await p.keyboard.press('Escape');
await p.evaluate(()=>postMessage({type:'ai',ai:{id:'openai',name:'Gemini',icon:null}},'*'));await p.waitForTimeout(200);
console.log('btn2:',await p.textContent('#tClaude'),'badge:',await p.$$eval('#tClaude .aiBadge',e=>e.length));
await p.screenshot({path:'/tmp/h/ai2.png',clip:{x:700,y:0,width:600,height:60}});
await p.evaluate(()=>postMessage({type:'ai',ai:{id:'zwischenablage',name:'KI',icon:null}},'*'));await p.waitForTimeout(200);
console.log('btn3:',await p.textContent('#tClaude'),'svg:',await p.$$eval('#tClaude svg',e=>e.length));
console.log(errs.join('\n')||'no errors');await b.close();})();
