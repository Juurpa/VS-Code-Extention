import fs from 'fs';
import fontkit from '/home/claude/lernmodus-vscode/node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js';
import {PDFDocument,StandardFonts,degrees} from '/home/claude/lernmodus-vscode/media/lib/pdf-lib.esm.min.js';
// 2: Helvetica, gedrehte Seiten
{const d=await PDFDocument.create(),f=await d.embedFont(StandardFonts.Helvetica);
 for(let k=0;k<4;k++){const p=d.addPage([420,300]);['Name: Max Mustermann','IBAN DE89 3704 0044 0532 0130 00','Rest bleibt lesbar: Biomedizintechnik'].forEach((s,i)=>p.drawText(s,{x:30,y:240-i*30,size:12,font:f}));p.setRotation(degrees(k*90));}
 fs.writeFileSync('rot.pdf',await d.save());}
// 3: Type0 Identity-H (Zwei-Byte-Codes)
{const d=await PDFDocument.create();d.registerFontkit(fontkit);const f=await d.embedFont(fs.readFileSync('/home/claude/lernmodus-vscode/media/lib/standard_fonts/LiberationSans-Regular.ttf'));
 const p=d.addPage([420,300]);['Name: Max Mustermann, Größe 182 cm','Äußerst vertraulich: DE89 3704 0044 0532 0130 00','Rest bleibt lesbar: Biomedizintechnik'].forEach((s,i)=>p.drawText(s,{x:30,y:240-i*30,size:12,font:f}));
 fs.writeFileSync('t0.pdf',await d.save());}
