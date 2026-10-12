'use strict';
module.exports = `
<div id="bar">
  <button class="tb icon" id="btnSide" title="Sidebar"><span class="ic" data-i="menu"></span></button>
  <div class="grp"><input id="pageInput" type="text" inputmode="numeric" value="1" aria-label="Page"><span class="muted">/ <span id="pageCount">0</span></span></div>
  <div class="sep"></div>
  <button class="tb icon" id="zoomOut" title="Zoom out"><span class="ic" data-i="minus"></span></button>
  <button class="tb" id="zoomLabel" title="Zoom">100 %</button>
  <button class="tb icon" id="zoomIn" title="Zoom in"><span class="ic" data-i="plus"></span></button>
  <div class="sep"></div>
  <div class="seg">
  <button class="tb" data-tool="hl" title="Highlight (H)"><span class="ic" data-i="marker"></span><span class="lbl">Highlight</span></button>
  <button class="tb" data-tool="note" title="Comment (C)"><span class="ic" data-i="comment"></span><span class="lbl">Comment</span></button>
  <button class="tb" data-tool="draw" title="Draw (D)"><span class="ic" data-i="pen"></span><span class="lbl">Draw</span></button>
  <button class="tb" data-tool="erase" title="Eraser (E)"><span class="ic" data-i="eraser"></span><span class="lbl">Eraser</span></button>
  </div>
  <div class="sep"></div>
  <button class="tb icon" id="tUndo" title="Undo (Ctrl+Z)" disabled><span class="ic" data-i="undo"></span></button>
  <button class="tb icon" id="tRedo" title="Redo (Ctrl+Y)" disabled><span class="ic" data-i="redo"></span></button>
  <div class="sep"></div>
  <button class="tb" id="tCards" title="Flashcards from your highlights"><span class="ic" data-i="cards"></span><span class="lbl">Flashcards</span></button>
  <button class="tb" id="tTools" title="PDF tools"><span class="ic" data-i="tools"></span><span class="lbl">Tools</span></button>
  <button class="tb primary" id="tClaude" title="Give the AI a task"><span class="ic" data-i="spark"></span><span class="lbl">AI</span></button>
  <span class="grow"></span>
  <button class="tb" id="tFile" title="Save changes to the PDF" hidden><span class="ic" data-i="save"></span><span class="lbl">Save</span></button>
  <button class="tb" id="tMarks" title="Open highlights as a text file"><span class="ic" data-i="file"></span><span class="lbl">Highlights</span></button>
  <button class="tb icon" id="tSave" title="Save a copy with highlights and signature burned in"><span class="ic" data-i="download"></span></button>
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
