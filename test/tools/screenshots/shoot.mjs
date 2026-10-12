// Drives the real webview UI (media/main.js) in headless Chromium and writes the README/Marketplace images.
//   node shoot.mjs [reader] [tools] [redact] [ocr] [gif]      (no argument = everything)
// Environment:
//   WORK    scratch dir with node_modules/playwright-core and data/ (invoice.pdf, order-file.pdf, scan.pdf); default ./work
//   OUT     output dir for the images; default <repo>/media/screenshots
//   CHROME  path to a Chromium binary
//   BASE    base URL of serve.mjs; default http://localhost:8765
// Needs serve.mjs running (it provides the harness page and the real redaction/OCR engines).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.env.WORK || path.join(here, 'work'));
const OUT = path.resolve(process.env.OUT || path.join(here, '../../../media/screenshots'));
const BASE = process.env.BASE || 'http://localhost:8765';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = createRequire(path.join(WORK, 'package.json'))('playwright-core');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(path.join(WORK, 'out'), { recursive: true });
const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['reader', 'tools', 'redact', 'ocr', 'gif']);
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// ---------------------------------------------------------------- helpers
async function open(pdf, { name = pdf, cursor = false, dsf = 1.25, ann, text = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${pdf}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push(`[${pdf}] console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${pdf}] HTTP ${r.status()} ${r.url()}`); });
  if (ann) await page.addInitScript((a) => { window.__initAnn = a; }, ann);
  await page.goto(`${BASE}/harness.html?pdf=${encodeURIComponent(pdf)}&name=${encodeURIComponent(name)}${cursor ? '&cursor=1' : ''}`);
  await page.waitForSelector('.page canvas', { timeout: 30000 });
  if (text) await page.waitForSelector('.page .textLayer span', { timeout: 30000 }).catch(() => {});
  // The UI never sets S.name from cfg.name (media/main.js; see README, known issue) -> file names in dialogs would be empty. Set it as intended.
  await page.evaluate((n) => { window.__werkbank.S.name = n; }, name);
  await sleep(1200);
  return { ctx, page };
}
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });
async function waitToast(page, re, timeout = 30000) {
  const t0 = Date.now();
  for (;;) { const t = await toastText(page); if (re.test(t)) return t; if (Date.now() - t0 > timeout) throw new Error('toast timeout: ' + re + ' last=' + t); await sleep(80); }
}
async function setZoom(page, pct) { await page.click('#zoomLabel'); await page.click(`#menuPop .mi:has-text("${pct} %")`); await sleep(900); }
async function menuItem(page, btn, label) { await page.click(btn); await sleep(120); await page.click(`#menuPop .mi:has-text("${label}")`); await sleep(250); }
async function goPage(page, n) { await page.evaluate((n) => { const i = document.querySelector('#pageInput'); i.value = n; i.dispatchEvent(new Event('change')); }, n); await sleep(900); }
// extra=true: scratch images (not part of the deliverable set) go to WORK/extras
async function shot(page, name, { extra = false, ...opts } = {}) {
  const dir = extra ? path.join(WORK, 'extras') : OUT; fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  await page.screenshot({ path: f, ...opts });
  return f;
}
// Rectangle (CSS px) of the text `str` inside a text-layer span of page n.
async function textRect(page, n, str, { whole = false } = {}) {
  const r = await page.evaluate(({ n, str, whole }) => {
    const spans = [...document.querySelectorAll(`.page[data-page="${n}"] .textLayer span`)];
    const sp = spans.find((s) => (whole ? s.textContent.trim() === str : s.textContent.includes(str)));
    if (!sp) return null;
    const tw = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); const tn = tw.nextNode();
    const i = tn.textContent.indexOf(str), range = document.createRange(); range.setStart(tn, i); range.setEnd(tn, i + str.length);
    const b = range.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, { n, str, whole });
  if (!r) throw new Error(`text not found on page ${n}: ${str}`);
  return r;
}
const union = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
// Select text in the text layer like a mouse selection would (then the page's own mouseup handler turns it into a highlight).
async function selectText(page, n, str, { release = true } = {}) {
  await textRect(page, n, str);
  await page.evaluate(({ n, str, release }) => {
    const sp = [...document.querySelectorAll(`.page[data-page="${n}"] .textLayer span`)].find((s) => s.textContent.includes(str));
    const tn = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT).nextNode(), i = tn.textContent.indexOf(str), r = document.createRange();
    r.setStart(tn, i); r.setEnd(tn, i + str.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    if (release) sp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { n, str, release });
  await sleep(250);
}
// Select a run of word spans (OCR text layers have one span per word) from the first span equal to `a` to the next span equal to `b`.
async function selectWords(page, n, a, b) {
  await page.evaluate(({ n, a, b }) => {
    const sp = [...document.querySelectorAll(`.page[data-page="${n}"] .textLayer span`)].filter((x) => x.textContent.trim());
    const i = sp.findIndex((x) => x.textContent.trim() === a), j = sp.findIndex((x, k) => k > i && x.textContent.trim() === b);
    if (i < 0 || j < 0) throw new Error('words not found: ' + a + '..' + b);
    const t0 = document.createTreeWalker(sp[i], NodeFilter.SHOW_TEXT).nextNode(), t1 = document.createTreeWalker(sp[j], NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange(); r.setStart(t0, 0); r.setEnd(t1, t1.textContent.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { n, a, b });
  await sleep(250);
}
async function highlight(page, n, str, colorIdx) {
  if (!(await page.$('[data-tool=hl].active'))) await page.click('[data-tool=hl]');
  await sleep(100);
  await page.click(`#toolOpts .swatch >> nth=${colorIdx}`);
  await selectText(page, n, str);
}
async function dragBox(page, r, pad = 3, onStep) {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
  await page.mouse.move(x0, y0, { steps: 6 }); if (onStep) await onStep('move');
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4); if (onStep) await onStep('drag'); }
  await page.mouse.up(); if (onStep) await onStep('up');
}
async function docBytes(page, file) {
  const b64 = await page.evaluate(() => { const b = window.__werkbank.S.bytes; let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}
// Boxes to redact: customer data (page 1) and mandate (page 2); returns rects per page.
async function redactTargets(page, n) {
  if (n === 1) return [union([await textRect(page, 1, 'Jane Example', { whole: true }), await textRect(page, 1, 'Sample Street 12'), await textRect(page, 1, '50667 Cologne'), await textRect(page, 1, 'Germany', { whole: true })]),
    await textRect(page, 1, '+49 221 5550142'), await textRect(page, 1, 'jane.example@example.com'), await textRect(page, 1, 'DE02 1203 0000 0000 2020 51')];
  return [await textRect(page, 2, 'Jane Example', { whole: true }), await textRect(page, 2, 'DE02 1203 0000 0000 2020 51'), await textRect(page, 2, 'jane.example@example.com')];
}

// ---------------------------------------------------------------- 1) reader + AI menu
if (want.has('reader')) {
  const { ctx, page } = await open('invoice.pdf');
  await setZoom(page, 100);
  await page.evaluate(() => { document.querySelector('#wrap').scrollTop = 0; }); await sleep(300);
  await highlight(page, 1, '26 October 2026', 0);
  await highlight(page, 1, 'Total amount (EUR)', 1);
  await highlight(page, 1, '1,174.29', 1);
  await highlight(page, 1, 'Monitor arm, dual, with cable management', 2);
  await highlight(page, 1, 'We delivered and assembled the items listed below on 28', 0);
  await page.click('[data-tool=hl]'); // back to select
  await page.click('[data-tool=note]'); await sleep(150);
  const row = await textRect(page, 1, '119.80');
  await page.mouse.click(row.x + row.w + 26, row.y + row.h / 2); await sleep(300);
  await page.fill('#notePop textarea', 'Two arms ordered, only one on the delivery note. Ask Example GmbH before paying.');
  await page.click('#notePop .pillBtn.primary'); await sleep(300);
  await page.click('[data-tool=note]'); await sleep(150);       // leave the comment tool
  await page.click('.noteMark'); await sleep(300);                 // reopen the comment to show it
  await page.evaluate(() => { document.querySelector('#notePop textarea').blur(); });
  await shot(page, 'reader.png');
  await page.evaluate(() => { document.querySelector('#wrap').scrollTop += 0; });
  console.log('annotations:', await page.evaluate(() => Object.values(window.__ann).map((a) => `${a.hl.length} highlights / ${a.notes.length} notes`).join(' ')));
  await page.mouse.click(300, 500); await sleep(200);
  await page.click('#tClaude'); await sleep(300);
  console.log('AI menu:', (await page.$$eval('#menuPop .mi', (e) => e.map((x) => x.textContent))).join(' | '));
  await shot(page, 'ai-tools.png');
  await ctx.close();
}

// ---------------------------------------------------------------- 2) page tools
if (want.has('tools')) {
  const { ctx, page } = await open('order-file.pdf', { name: 'order-file.pdf' });
  await setZoom(page, 75);
  await page.click('.thumb[data-page="2"]'); await page.click('.thumb[data-page="4"]', { modifiers: ['Shift'] }); await sleep(500);
  await page.evaluate(() => { document.querySelector('#side').scrollTop = 0; }); await sleep(300);
  await page.click('#tTools'); await sleep(300);
  console.log('Tools menu:', (await page.$$eval('#menuPop .mi', (e) => e.map((x) => x.textContent))).join(' | '));
  await shot(page, 'page-tools.png');
  await page.keyboard.press('Escape'); await page.mouse.click(640, 400); await sleep(200);
  // extra: merge dialog
  await page.evaluate(() => { window.__pick = [{ name: 'photos-appendix.pdf', b64: '' }, { name: 'signed-contract.pdf', b64: '' }]; });
  await menuItem(page, '#tTools', 'Merge PDFs');
  await page.click('.modal .pillBtn:has-text("Add PDF files")'); await sleep(300);
  await shot(page, 'page-tools-merge.png');
  await ctx.close();
}

// ---------------------------------------------------------------- 3) redaction (real engine) + independent check input
if (want.has('redact')) {
  const { ctx, page } = await open('invoice.pdf');
  await setZoom(page, 75);
  await menuItem(page, '#tTools', 'Redact');
  for (const r of await redactTargets(page, 1)) await dragBox(page, r);
  await goPage(page, 2);
  for (const r of await redactTargets(page, 2)) await dragBox(page, r);
  await goPage(page, 1);
  await page.evaluate(() => { document.querySelector('#wrap').scrollTop += 110; }); await sleep(500); // keeps the bars clear of the toast
  console.log('toolOpts:', await page.$eval('#toolOpts', (e) => e.textContent.replace(/\s+/g, ' ')));
  await shot(page, 'redact-before.png');
  await page.click('#toolOpts .pillBtn.primary');
  const t = await waitToast(page, /Redacted|Error/, 60000); console.log('toast:', t);
  await sleep(1500);
  await page.keyboard.press('Escape'); await sleep(500); // leave the redact tool (the options bar still shows the old count otherwise; see README)
  await shot(page, 'redact-after.png');
  await docBytes(page, path.join(WORK, 'out', 'invoice-redacted.pdf'));
  await ctx.close();
}

// ---------------------------------------------------------------- 4) OCR on a synthetic scan (real engine; slow)
if (want.has('ocr')) {
  const { ctx, page } = await open('scan.pdf', { name: 'scan.pdf', text: false });
  await setZoom(page, 75);
  await waitToast(page, /looks like a scan/, 15000).catch(() => {});
  await shot(page, 'ocr-hint.png', { extra: true });
  await menuItem(page, '#tTools', 'Text recognition');
  await page.waitForSelector('.modal select'); await sleep(2200); // let the "Checking pages" toast fade
  await page.selectOption('.modal .fld:has(span:text("Language")) select', 'eng');
  await shot(page, 'ocr-dialog.png');
  await page.click('.modal .pillBtn.primary'); await sleep(1500);
  await shot(page, 'ocr-progress.png', { extra: true });
  const t = await waitToast(page, /Text recognized|Error/, 240000); console.log('OCR toast:', t);
  await sleep(1500);
  await page.evaluate(() => { document.querySelector('#wrap').scrollTop = 0; }); await sleep(600);
  await selectWords(page, 1, 'Jane', 'Germany').catch((e) => console.log('select:', e.message));
  await shot(page, 'ocr.png');
  await docBytes(page, path.join(WORK, 'out', 'scan-ocr.pdf'));
  await ctx.close();
}

// ---------------------------------------------------------------- 5) GIF: open -> bars -> apply -> verified
if (want.has('gif')) {
  const frames = path.join(WORK, 'frames'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  const { ctx, page } = await open('invoice.pdf', { cursor: true, dsf: 1 });
  await setZoom(page, 75);
  await page.mouse.move(900, 300);
  const list = []; let k = 0;
  const grab = async (dur) => { const f = path.join(frames, `f${String(k++).padStart(3, '0')}.png`); await page.screenshot({ path: f }); list.push([f, dur]); };
  await grab(1.0);
  const tb = await page.$eval('#tTools', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(tb.x, tb.y, { steps: 12 }); await grab(0.3);
  await page.click('#tTools'); await sleep(250); await grab(0.8);
  const mi = await page.$eval('#menuPop .mi:has-text("Redact")', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + 60, y: b.top + b.height / 2 }; });
  await page.mouse.move(mi.x, mi.y, { steps: 8 }); await grab(0.4);
  await page.mouse.click(mi.x, mi.y); await sleep(300);
  await page.evaluate(() => { document.querySelector('#wrap').scrollTop += 110; }); await sleep(400); // keeps the bars clear of the toast
  await grab(0.5);
  for (const r of await redactTargets(page, 1)) {
    await dragBox(page, r, 3, async (ph) => { if (ph === 'move') await grab(0.1); else if (ph === 'drag') await grab(0.08); else await grab(0.32); });
  }
  const ap = await page.$eval('#toolOpts .pillBtn.primary', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(ap.x, ap.y, { steps: 12 }); await grab(0.7);
  await page.mouse.down(); await page.mouse.up();
  // frames while the engine works, then the result
  for (let i = 0; i < 6; i++) { if (/Redacted/.test(await toastText(page))) break; await grab(0.3); }
  await waitToast(page, /Redacted|Error/, 60000); await sleep(700);
  await grab(1.0);
  await page.keyboard.press('Escape'); await sleep(500); // leave the redact tool
  await grab(2.4);
  await ctx.close();
  const cc = path.join(frames, 'list.txt');
  fs.writeFileSync(cc, list.map(([f, d]) => `file '${f}'\nduration ${d}`).join('\n') + `\nfile '${list[list.length - 1][0]}'\n`);
  console.log('gif frames', list.length, 'total s', list.reduce((a, [, d]) => a + d, 0).toFixed(1));
  const pal = path.join(frames, 'pal.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', cc, '-vf', 'fps=12,scale=900:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff', pal]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', cc, '-i', pal, '-lavfi', 'fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', path.join(OUT, 'demo.gif')]);
}

await browser.close();
// Keep every PNG well below 600 KB (noisy scans compress badly): quantize to 256 colors without dithering (visually identical here).
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.png'))) {
  const fp = path.join(OUT, f);
  if (fs.statSync(fp).size > 450 * 1024) execFileSync('convert', [fp, '-strip', '-dither', 'None', '-colors', '256', '-define', 'png:compression-level=9', 'PNG8:' + fp]);
}
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console/page errors');
