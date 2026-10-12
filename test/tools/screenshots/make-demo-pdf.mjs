// Builds the fictional demo documents for the README/Marketplace screenshots.
// Usage: node make-demo-pdf.mjs <out-dir>
// Writes <out-dir>/invoice.pdf (2 pages) and <out-dir>/invoice.expect.json
// (strings that must be gone after redaction / must survive it).
// ALL data is invented: "Jane Example", "Example GmbH", example.com, and the well-known test IBAN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from '../../../media/lib/pdf-lib.esm.min.js';

const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });

export const PERSON = {
  name: 'Jane Example', street: 'Sample Street 12', city: '50667 Cologne',
  phone: '+49 221 5550142', email: 'jane.example@example.com', iban: 'DE02 1203 0000 0000 2020 51', customerNo: 'K-20417'
};

const doc = await PDFDocument.create();
doc.setTitle('Invoice 2026-0412'); doc.setAuthor('Example GmbH'); doc.setProducer('Werkbank demo');
const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
const W = 595.28, H = 841.89, M = 56;
const ink = rgb(0.13, 0.15, 0.19), gray = rgb(0.42, 0.45, 0.5), brand = rgb(0.1, 0.27, 0.55), light = rgb(0.93, 0.95, 0.98), line = rgb(0.8, 0.83, 0.88);

function txt(p, s, x, y, { size = 10, font = F, color = ink, align = 'left' } = {}) {
  const w = font.widthOfTextAtSize(s, size);
  p.drawText(s, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: H - y, size, font, color });
}
function wrap(s, font, size, maxW) {
  const lines = []; let cur = '';
  for (const w of s.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function para(p, s, x, y, maxW, { size = 10, lead = 14.5, font = F, color = ink } = {}) {
  for (const l of wrap(s, font, size, maxW)) { txt(p, l, x, y, { size, font, color }); y += lead; } return y;
}
function band(p, title) {
  p.drawRectangle({ x: 0, y: H - 78, width: W, height: 78, color: brand });
  txt(p, 'Example GmbH', M, 40, { size: 20, font: B, color: rgb(1, 1, 1) });
  txt(p, 'Office furniture & workplace design', M, 58, { size: 9, color: rgb(0.8, 0.87, 1) });
  txt(p, title, W - M, 40, { size: 11, font: B, color: rgb(1, 1, 1), align: 'right' });
  txt(p, 'Invoice 2026-0412', W - M, 58, { size: 9, color: rgb(0.8, 0.87, 1), align: 'right' });
}
function footer(p, n) {
  p.drawLine({ start: { x: M, y: 60 }, end: { x: W - M, y: 60 }, thickness: 0.6, color: line });
  txt(p, 'Example GmbH · Industrial Road 1 · 44139 Dortmund · Germany · VAT ID DE000000000', M, H - 44, { size: 7.5, color: gray });
  txt(p, 'Page ' + n + ' of 2', W - M, H - 44, { size: 7.5, color: gray, align: 'right' });
}

// ---------- Page 1: invoice
let p = doc.addPage([W, H]); band(p, 'INVOICE');
txt(p, 'Example GmbH · Industrial Road 1 · 44139 Dortmund', M, 112, { size: 7, color: gray });
p.drawLine({ start: { x: M, y: H - 116 }, end: { x: M + 215, y: H - 116 }, thickness: 0.4, color: line });
txt(p, PERSON.name, M, 134, { size: 11, font: B });
txt(p, PERSON.street, M, 149, { size: 11 });
txt(p, PERSON.city, M, 164, { size: 11 });
txt(p, 'Germany', M, 179, { size: 11 });
const mx = 350; let my = 112;
for (const [k, v] of [['Invoice no.', '2026-0412'], ['Invoice date', '12 October 2026'], ['Due date', '26 October 2026'], ['Customer no.', PERSON.customerNo]]) {
  txt(p, k, mx, my, { size: 9, color: gray }); txt(p, v, W - M, my, { size: 9.5, font: B, align: 'right' }); my += 16;
}
txt(p, 'Invoice 2026-0412 – Home office set', M, 232, { size: 15, font: B, color: brand });
txt(p, 'Dear customer,', M, 262, { size: 10 });
para(p, 'thank you for your order of 2 September 2026. We delivered and assembled the items listed below on 28 September 2026. Please find the invoice for your home office set attached.', M, 280, W - 2 * M);

// table
let ty = 330; const cx = [M + 8, M + 36, W - M - 150, W - M - 82, W - M - 8];
p.drawRectangle({ x: M, y: H - ty - 12, width: W - 2 * M, height: 24, color: light });
for (const [i, s] of ['Pos.', 'Description', 'Qty', 'Unit price', 'Total'].entries()) txt(p, s, [cx[0], cx[1], cx[2], cx[3], cx[4]][i], ty + 8, { size: 9, font: B, align: i >= 2 ? 'right' : 'left' });
const rows = [['1', 'Height-adjustable desk "Linea", 160 x 80 cm', '1', '489.00', '489.00'], ['2', 'Ergonomic office chair "Flex Pro"', '1', '329.00', '329.00'], ['3', 'Monitor arm, dual, with cable management', '2', '59.90', '119.80'], ['4', 'Delivery and assembly', '1', '49.00', '49.00']];
ty += 30;
for (const r of rows) { txt(p, r[0], cx[0], ty, { size: 9.5 }); txt(p, r[1], cx[1], ty, { size: 9.5 }); txt(p, r[2], cx[2], ty, { size: 9.5, align: 'right' }); txt(p, r[3], cx[3], ty, { size: 9.5, align: 'right' }); txt(p, r[4], cx[4], ty, { size: 9.5, align: 'right' });
  p.drawLine({ start: { x: M, y: H - ty - 7 }, end: { x: W - M, y: H - ty - 7 }, thickness: 0.4, color: line }); ty += 24; }
ty += 4;
for (const [k, v, b] of [['Net total', '986.80'], ['VAT 19 %', '187.49'], ['Total amount (EUR)', '1,174.29', true]]) {
  txt(p, k, W - M - 110, ty, { size: b ? 10.5 : 9.5, font: b ? B : F, align: 'right' }); txt(p, v, W - M - 8, ty, { size: b ? 10.5 : 9.5, font: b ? B : F, align: 'right' }); ty += b ? 0 : 16; }
ty += 36;
// customer data box
p.drawRectangle({ x: M, y: H - ty - 112, width: W - 2 * M, height: 112, color: light });
txt(p, 'Customer and payment data', M + 14, ty + 18, { size: 10, font: B, color: brand });
let by = ty + 40;
for (const [k, v] of [['Phone', PERSON.phone], ['E-mail', PERSON.email], ['IBAN (direct debit)', PERSON.iban]]) { txt(p, k, M + 14, by, { size: 9.5, color: gray }); txt(p, v, M + 140, by, { size: 10.5, font: B }); by += 20; }
txt(p, 'The amount is debited from this account on 26 October 2026.', M + 14, by + 2, { size: 8.5, color: gray });
footer(p, 1);

// ---------- Page 2: terms + mandate
p = doc.addPage([W, H]); band(p, 'TERMS');
txt(p, 'Payment terms and SEPA direct debit mandate', M, 120, { size: 15, font: B, color: brand });
let y = para(p, 'The invoice amount is due within 14 days of the invoice date. By signing the mandate below you authorise Example GmbH to collect payments from your account by direct debit and instruct your bank to honour these debits. You can request a refund within eight weeks, starting from the date on which your account was debited.', M, 148, W - 2 * M);
y += 8; txt(p, 'Warranty and returns', M, y, { size: 11.5, font: B }); y += 18;
y = para(p, 'We give a two-year warranty on all items. Items can be returned within 30 days in their original packaging. Assembled furniture is excluded from the return right unless a defect is found. For warranty claims please keep this invoice; it serves as proof of purchase.', M, y, W - 2 * M);
y += 8; txt(p, 'Data protection', M, y, { size: 11.5, font: B }); y += 18;
y = para(p, 'We store your contact and payment data only for as long as it is needed to process the contract and to meet statutory retention periods. You can request access, correction or deletion at any time at privacy@example.com.', M, y, W - 2 * M);
y += 14;
p.drawRectangle({ x: M, y: H - y - 136, width: W - 2 * M, height: 136, borderColor: line, borderWidth: 0.8 });
txt(p, 'SEPA direct debit mandate', M + 14, y + 20, { size: 10.5, font: B, color: brand });
let ry = y + 44;
for (const [k, v] of [['Mandate reference', 'EX-2026-0412-77'], ['Account holder', PERSON.name], ['IBAN', PERSON.iban], ['Contact for queries', PERSON.email]]) { txt(p, k, M + 14, ry, { size: 9.5, color: gray }); txt(p, v, M + 140, ry, { size: 10.5, font: k === 'Mandate reference' ? F : B }); ry += 20; }
txt(p, 'Signed on 12 October 2026', M + 14, ry + 8, { size: 9, color: gray });
y += 168;
p.drawLine({ start: { x: M, y: H - y - 40 }, end: { x: M + 200, y: H - y - 40 }, thickness: 0.6, color: ink });
txt(p, 'Signature of the account holder', M, y + 52, { size: 8.5, color: gray });
txt(p, 'Questions? Mark Sample, billing team: billing@example.com, +49 231 5550199', W - M, y + 52, { size: 8.5, color: gray, align: 'right' });
footer(p, 2);

fs.writeFileSync(path.join(out, 'invoice.pdf'), await doc.save());
fs.writeFileSync(path.join(out, 'invoice.expect.json'), JSON.stringify({
  gone: ['Jane Example', 'Sample Street 12', '50667', 'Cologne', '+49 221 5550142', '5550142', 'jane.example@example.com', 'DE02 1203 0000 0000 2020 51', '2020 51'],
  kept: ['Example GmbH', 'Invoice 2026-0412', 'Height-adjustable desk', 'Total amount', 'Mark Sample', 'billing@example.com', 'Mandate reference']
}, null, 2));
console.log('wrote', path.join(out, 'invoice.pdf'));

// ---------- order-file.pdf: 6 pages in different layouts (for the page-tools / merge screenshots)
{
  const inv = await PDFDocument.load(fs.readFileSync(path.join(out, 'invoice.pdf')));
  const o = await PDFDocument.create(); o.setTitle('Order file 2026-0412');
  const OF = await o.embedFont(StandardFonts.Helvetica), OB = await o.embedFont(StandardFonts.HelveticaBold);
  const t = (pg, s, x, y, h, { size = 10, font = OF, color = ink, align = 'left' } = {}) => { const w = font.widthOfTextAtSize(s, size); pg.drawText(s, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: h - y, size, font, color }); };
  // 1 cover
  let c = o.addPage([W, H]);
  c.drawRectangle({ x: 0, y: 0, width: W, height: H, color: brand });
  c.drawRectangle({ x: M, y: H - 250, width: 60, height: 6, color: rgb(0.43, 0.64, 0.96) });
  t(c, 'Order file', M, 290, H, { size: 40, font: OB, color: rgb(1, 1, 1) });
  t(c, 'Home office set · 2026-0412', M, 330, H, { size: 16, color: rgb(0.8, 0.87, 1) });
  t(c, 'Example GmbH', M, H - 90, H, { size: 12, font: OB, color: rgb(1, 1, 1) });
  t(c, 'Contents: invoice, terms, delivery note, floor plan, warranty card', M, H - 70, H, { size: 9, color: rgb(0.8, 0.87, 1) });
  // 2-3 invoice pages
  for (const pg of await o.copyPages(inv, [0, 1])) o.addPage(pg);
  // 4 delivery note
  let d = o.addPage([W, H]);
  d.drawRectangle({ x: 0, y: H - 78, width: W, height: 78, color: rgb(0.13, 0.45, 0.35) });
  t(d, 'Delivery note', M, 48, H, { size: 22, font: OB, color: rgb(1, 1, 1) });
  t(d, 'No. DN-88120 · 28 September 2026', W - M, 48, H, { size: 10, color: rgb(0.85, 1, 0.93), align: 'right' });
  const items = [['Height-adjustable desk "Linea"', '1', 'Packed, 2 boxes'], ['Ergonomic office chair "Flex Pro"', '1', 'Assembled'], ['Monitor arm, dual', '2', 'Packed'], ['Cable management kit', '1', 'Packed']];
  let dy = 140; d.drawRectangle({ x: M, y: H - dy - 10, width: W - 2 * M, height: 26, color: rgb(0.9, 0.96, 0.94) });
  t(d, 'Item', M + 8, dy + 6, H, { size: 9, font: OB }); t(d, 'Qty', 360, dy + 6, H, { size: 9, font: OB }); t(d, 'Status', 420, dy + 6, H, { size: 9, font: OB }); dy += 34;
  for (const r of items) { t(d, r[0], M + 8, dy, H); t(d, r[1], 360, dy, H); t(d, r[2], 420, dy, H); d.drawLine({ start: { x: M, y: H - dy - 8 }, end: { x: W - M, y: H - dy - 8 }, thickness: 0.4, color: line }); dy += 26; }
  t(d, 'Received in good condition: ______________________', M, dy + 70, H, { size: 10, color: gray });
  // 5 floor plan (landscape)
  const lw = H, lh = W; let f = o.addPage([lw, lh]);
  t(f, 'Floor plan – workspace layout', M, 56, lh, { size: 18, font: OB, color: brand });
  f.drawRectangle({ x: M, y: 70, width: lw - 2 * M, height: lh - 160, borderColor: ink, borderWidth: 2 });
  f.drawRectangle({ x: M + 40, y: lh - 330, width: 220, height: 90, color: light, borderColor: brand, borderWidth: 1.5 }); t(f, 'Desk 160 x 80', M + 150, 250, lh, { size: 10, align: 'center', color: brand });
  f.drawCircle({ x: M + 150, y: lh - 380, size: 26, color: rgb(0.98, 0.93, 0.8), borderColor: rgb(0.8, 0.55, 0.1), borderWidth: 1.5 });
  f.drawRectangle({ x: lw - M - 190, y: 90, width: 150, height: 40, color: rgb(0.9, 0.96, 0.94), borderColor: rgb(0.13, 0.45, 0.35), borderWidth: 1.5 }); t(f, 'Shelf', lw - M - 115, lh - 118, lh, { size: 10, align: 'center' });
  f.drawLine({ start: { x: lw - M, y: 200 }, end: { x: lw - M, y: 260 }, thickness: 6, color: rgb(1, 1, 1) }); t(f, 'Window', lw - M - 14, lh - 232, lh, { size: 9, align: 'right', color: gray });
  // 6 warranty card
  let w = o.addPage([W, H]);
  t(w, 'Warranty card', M, 80, H, { size: 24, font: OB, color: brand });
  w.drawRectangle({ x: M, y: H - 330, width: W - 2 * M, height: 190, borderColor: brand, borderWidth: 1.5, color: rgb(0.97, 0.98, 1) });
  for (const [i, s] of ['Product: Height-adjustable desk "Linea"', 'Serial no.: LN-2026-004417', 'Purchase date: 2 September 2026', 'Warranty period: 24 months', 'Service hotline: +49 231 5550100'].entries()) t(w, s, M + 20, 170 + i * 26, H, { size: 11 });
  t(w, 'Keep this card together with your invoice.', M, 370, H, { size: 10, color: gray });
  fs.writeFileSync(path.join(out, 'order-file.pdf'), await o.save());
  console.log('wrote', path.join(out, 'order-file.pdf'));
}
