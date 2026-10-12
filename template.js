'use strict';
module.exports = `
<div id="bar">
  <button class="tb icon" id="btnSide" title="Seitenleiste"><span class="ic" data-i="menu"></span></button>
  <div class="grp"><input id="pageInput" type="text" inputmode="numeric" value="1" aria-label="Seite"><span class="muted">/ <span id="pageCount">0</span></span></div>
  <div class="sep"></div>
  <button class="tb icon" id="zoomOut" title="Verkleinern"><span class="ic" data-i="minus"></span></button>
  <button class="tb" id="zoomLabel" title="Zoom">100 %</button>
  <button class="tb icon" id="zoomIn" title="Vergrößern"><span class="ic" data-i="plus"></span></button>
  <div class="sep"></div>
  <div class="seg">
  <button class="tb" data-tool="hl" title="Markieren (H)"><span class="ic" data-i="marker"></span><span class="lbl">Markieren</span></button>
  <button class="tb" data-tool="note" title="Kommentar (C)"><span class="ic" data-i="comment"></span><span class="lbl">Kommentar</span></button>
  <button class="tb" data-tool="draw" title="Zeichnen (D)"><span class="ic" data-i="pen"></span><span class="lbl">Zeichnen</span></button>
  <button class="tb" data-tool="erase" title="Radierer (E)"><span class="ic" data-i="eraser"></span><span class="lbl">Radierer</span></button>
  </div>
  <div class="sep"></div>
  <button class="tb icon" id="tUndo" title="Rückgängig (Strg+Z)" disabled><span class="ic" data-i="undo"></span></button>
  <button class="tb icon" id="tRedo" title="Wiederholen (Strg+Y)" disabled><span class="ic" data-i="redo"></span></button>
  <div class="sep"></div>
  <button class="tb" id="tCards" title="Karteikarten aus deinen Markierungen"><span class="ic" data-i="cards"></span><span class="lbl">Karteikarten</span></button>
  <button class="tb" id="tTools" title="PDF-Werkzeuge"><span class="ic" data-i="tools"></span><span class="lbl">Werkzeuge</span></button>
  <button class="tb primary" id="tClaude" title="Aufgabe an die KI geben"><span class="ic" data-i="spark"></span><span class="lbl">KI</span></button>
  <span class="grow"></span>
  <button class="tb" id="tFile" title="Änderungen an der PDF speichern" hidden><span class="ic" data-i="save"></span><span class="lbl">Speichern</span></button>
  <button class="tb" id="tMarks" title="Markierungen als Textdatei öffnen"><span class="ic" data-i="file"></span><span class="lbl">Markierungen</span></button>
  <button class="tb icon" id="tSave" title="Kopie mit eingebrannten Markierungen und Unterschrift speichern"><span class="ic" data-i="download"></span></button>
</div>
<div id="toolOpts" hidden></div>
<div id="main">
  <div id="sideCol"><div id="selBar" hidden></div><aside id="side" tabindex="0"></aside></div>
  <section id="wrap"><div id="viewer"></div><div id="msg" hidden></div></section>
</div>
<div id="menuPop" hidden></div>
<div id="selPop" hidden></div>
<div id="notePop" hidden></div>
<div id="toast" hidden></div>
<div id="modalRoot"></div>
`;
