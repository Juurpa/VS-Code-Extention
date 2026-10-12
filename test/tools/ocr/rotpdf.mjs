import fs from 'node:fs'; import { PDFDocument, degrees } from '/home/claude/lernmodus-vscode/media/lib/pdf-lib.esm.min.js';
const d = await PDFDocument.load(fs.readFileSync(process.argv[2])); d.getPage(0).setRotation(degrees(+process.argv[4])); fs.writeFileSync(process.argv[3], await d.save());
