'use strict';
// Print and e-mail: the extension never prints or sends by itself. It prepares a file and hands it to the system
// (PDF program for printing, mail program for a draft); the user prints or presses "Send".
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmpDir = () => { const d = path.join(os.tmpdir(), 'pdf-workbench'); fs.mkdirSync(d, { recursive: true }); return d; };
const safeName = (n) => String(n || 'document.pdf').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
// Files handed to the OS handler: always end in .pdf, whatever extension the webview sent
const pdfName = (n) => safeName(n).replace(/[.\s]+$/, '').replace(/\.pdf$/i, '').slice(0, 115) + '.pdf';
const isPdf = (bytes) => bytes.length > 4 && bytes.subarray(0, 1024).includes('%PDF-');

/** Writes bytes to a fresh temporary file and returns its path (old print/mail files are removed after a day). */
function tempFile(name, bytes) {
  const dir = tmpDir();
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { force: true, recursive: true }); } } catch (e) { /* cleanup only */ }
  const sub = fs.mkdtempSync(path.join(dir, 'f-'));
  const file = path.join(sub, safeName(name));
  fs.writeFileSync(file, bytes);
  return file;
}

// RFC 2047 for headers with umlauts
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');
const b64Lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

/**
 * Builds an unsent e-mail (.eml with "X-Unsent: 1"): Outlook and most mail programs open it as an editable draft
 * with the PDF already attached. Nothing is sent.
 */
function buildEml({ to = '', subject = '', body = '', fileName, bytes }) {
  const b = 'pdfwb-' + Date.now().toString(36);
  const name = safeName(fileName);
  return Buffer.from([
    'X-Unsent: 1',
    to ? 'To: ' + to.replace(/[\r\n]/g, '') : 'To: ',
    'Subject: ' + encWord(String(subject).replace(/[\r\n]/g, ' ')),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    '--' + b,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(String(body).replace(/\r?\n/g, '\r\n'), 'utf8')),
    '--' + b,
    `Content-Type: application/pdf; name="${encWord(name)}"`,
    `Content-Disposition: attachment; filename="${encWord(name)}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(bytes)),
    '--' + b + '--',
    ''
  ].join('\r\n'), 'utf8');
}

module.exports = { tempFile, buildEml, safeName, pdfName, isPdf };
