// Minimaler Parser für PDF-Seiteninhalt (Content Streams): zerlegt in Anweisungen und merkt sich die Byte-Bereiche,
// damit unveränderte Teile Byte für Byte erhalten bleiben.
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isWs = (c) => WS.has(c);
const isReg = (c) => !WS.has(c) && !DELIM.has(c);
const hexv = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

/** Zerlegt `b` (Uint8Array) in Anweisungen: { op, operands:[{t,v,s,e}], start, end } */
export function parseContent(b) {
  const n = b.length, out = [];
  let i = 0, operands = [], stStart = -1;

  function skipWs() {
    for (;;) {
      while (i < n && isWs(b[i])) i++;
      if (i < n && b[i] === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
      break;
    }
  }
  function readString() { // an '(' ; liefert Bytes
    const bytes = []; let depth = 1; i++;
    while (i < n && depth > 0) {
      const c = b[i++];
      if (c === 0x5c) {
        const d = b[i++];
        if (d === 110) bytes.push(10); else if (d === 114) bytes.push(13); else if (d === 116) bytes.push(9); else if (d === 98) bytes.push(8); else if (d === 102) bytes.push(12);
        else if (d >= 48 && d <= 55) { let v = d - 48, k = 0; while (k < 2 && b[i] >= 48 && b[i] <= 55) { v = v * 8 + (b[i++] - 48); k++; } bytes.push(v & 255); }
        else if (d === 13) { if (b[i] === 10) i++; } else if (d === 10) { /* Zeilenfortsetzung */ } else bytes.push(d);
      } else if (c === 0x28) { depth++; bytes.push(c); } else if (c === 0x29) { depth--; if (depth > 0) bytes.push(c); } else bytes.push(c);
    }
    return Uint8Array.from(bytes);
  }
  function readHex() {
    const bytes = []; let hi = -1; i++;
    while (i < n && b[i] !== 0x3e) { const v = hexv(b[i++]); if (v < 0) continue; if (hi < 0) hi = v; else { bytes.push(hi * 16 + v); hi = -1; } }
    if (hi >= 0) bytes.push(hi * 16); i++;
    return Uint8Array.from(bytes);
  }
  function readToken() { // liefert Token oder null bei Ende / Klammer-Ende
    skipWs(); if (i >= n) return null;
    const s = i, c = b[i];
    if (c === 0x28) { const v = readString(); return { t: 'str', v, s, e: i }; }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) { i += 2; const items = []; for (;;) { skipWs(); if (i >= n) break; if (b[i] === 0x3e && b[i + 1] === 0x3e) { i += 2; break; } const t = readToken(); if (!t) break; items.push(t); } return { t: 'dict', v: items, s, e: i }; }
      const v = readHex(); return { t: 'str', v, s, e: i, hex: true };
    }
    if (c === 0x5b) { i++; const items = []; for (;;) { skipWs(); if (i >= n) break; if (b[i] === 0x5d) { i++; break; } const t = readToken(); if (!t) break; items.push(t); } return { t: 'arr', v: items, s, e: i }; }
    if (c === 0x5d || c === 0x29 || c === 0x3e || c === 0x7b || c === 0x7d) { i++; return { t: 'junk', v: String.fromCharCode(c), s, e: i }; }
    if (c === 0x2f) { i++; while (i < n && isReg(b[i])) i++; return { t: 'name', v: Buffer.from(b.subarray(s + 1, i)).toString('latin1'), s, e: i }; }
    while (i < n && isReg(b[i])) i++;
    const w = Buffer.from(b.subarray(s, i)).toString('latin1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w), s, e: i };
    return { t: 'op', v: w, s, e: i };
  }

  for (;;) {
    const tok = readToken(); if (!tok) break;
    if (stStart < 0) stStart = tok.s;
    if (tok.t !== 'op') { operands.push(tok); continue; }
    let end = tok.e;
    if (tok.v === 'BI') { // Inline-Bild: Daten bis EI überspringen
      for (;;) { const t = readToken(); if (!t || (t.t === 'op' && t.v === 'ID')) break; }
      if (i < n && isWs(b[i])) i++;
      let k = i, found = -1;
      while (k < n - 1) { if (b[k] === 0x45 && b[k + 1] === 0x49 && (k === 0 || isWs(b[k - 1])) && (k + 2 >= n || isWs(b[k + 2]))) { found = k; break; } k++; }
      if (found < 0) found = n - 2;
      i = found + 2; end = i;
    }
    out.push({ op: tok.v, operands, start: stStart, end });
    operands = []; stStart = -1;
  }
  return out;
}

/** Bytes einer Zeichenkette -> Hex-Schreibweise */
export const hex = (u8) => '<' + Buffer.from(u8).toString('hex') + '>';
