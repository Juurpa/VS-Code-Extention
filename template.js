'use strict';
// Every toolbar element carries data-bar="<id>": media/bar.js arranges them in the order the user chose
// (hidden ones wait in #barStore). Tool buttons (data-tool) next to each other are grouped automatically.
module.exports = `
<div id="bar">
  <button class="tb icon" id="btnSide" data-bar="side" title="Sidebar"><span class="ic" data-i="menu"></span></button>
  <div class="grp" data-bar="page"><input id="pageInput" type="text" inputmode="numeric" value="1" aria-label="Page"><span class="muted">/ <span id="pageCount">0</span></span></div>
  <div class="grp" data-bar="zoom">
    <button class="tb icon" id="zoomOut" title="Zoom out"><span class="ic" data-i="minus"></span></button>
    <button class="tb" id="zoomLabel" title="Zoom and view">100 %</button>
    <button class="tb icon" id="zoomIn" title="Zoom in"><span class="ic" data-i="plus"></span></button>
  </div>
  <button class="tb" data-bar="hl" data-tool="hl" title="Highlight, underline, strike through (H)"><span class="ic" data-i="marker"></span><span class="lbl">Highlight</span></button>
  <button class="tb" data-bar="note" data-tool="note" title="Comment (C)"><span class="ic" data-i="comment"></span><span class="lbl">Comment</span></button>
  <button class="tb" data-bar="draw" data-tool="draw" title="Draw and shapes (D)"><span class="ic" data-i="pen"></span><span class="lbl">Draw</span></button>
  <button class="tb" data-bar="text" data-tool="text" title="Add text (T)"><span class="ic" data-i="addText"></span><span class="lbl">Text</span></button>
  <button class="tb" data-bar="edit" data-tool="edit" title="Edit text in the PDF (R)"><span class="ic" data-i="editText"></span><span class="lbl">Edit text</span></button>
  <button class="tb" data-bar="image" data-tool="image" title="Insert image (I)"><span class="ic" data-i="image"></span><span class="lbl">Image</span></button>
  <button class="tb" data-bar="erase" data-tool="erase" title="Eraser (E)"><span class="ic" data-i="eraser"></span><span class="lbl">Eraser</span></button>
  <button class="tb icon" id="tUndo" data-bar="undo" title="Undo (Ctrl+Z)" disabled><span class="ic" data-i="undo"></span></button>
  <button class="tb icon" id="tRedo" data-bar="redo" title="Redo (Ctrl+Y)" disabled><span class="ic" data-i="redo"></span></button>
  <button class="tb" id="tCards" data-bar="cards" title="Flashcards from your highlights"><span class="ic" data-i="cards"></span><span class="lbl">Flashcards</span></button>
  <button class="tb" id="tTools" data-bar="tools" title="PDF tools"><span class="ic" data-i="tools"></span><span class="lbl">Tools</span></button>
  <button class="tb primary" id="tClaude" data-bar="ai" title="Give the AI a task"><span class="ic" data-i="spark"></span><span class="lbl">AI</span></button>
  <button class="tb icon" id="tSearch" data-bar="search" title="Search (Ctrl+F)"><span class="ic" data-i="search"></span></button>
  <button class="tb" id="tMarks" data-bar="marks" title="Highlights and comments"><span class="ic" data-i="list"></span><span class="lbl">Highlights</span></button>
  <button class="tb icon" id="tPrint" data-bar="print" title="Print …"><span class="ic" data-i="print"></span></button>
  <button class="tb icon" id="tMail" data-bar="mail" title="Send by e-mail …"><span class="ic" data-i="mail"></span></button>
  <button class="tb icon" id="tSave" data-bar="copy" title="Save a copy with annotations …"><span class="ic" data-i="download"></span></button>
  <button class="tb" id="tFile" data-bar="file" title="File: save, save as, copy, print, e-mail"><span class="ic" data-i="save"></span><span class="lbl">File</span></button>
</div>
<div id="barStore" hidden></div>
<div id="toolOpts" hidden></div>
<div id="main">
  <div id="sideCol">
    <div id="sideTabs" role="tablist">
      <button class="stab on" data-pane="pages" role="tab" title="Pages"><span class="ic" data-i="pages"></span></button>
      <button class="stab" data-pane="marks" role="tab" title="Highlights and comments"><span class="ic" data-i="list"></span><b class="cnt" id="marksCnt"></b></button>
      <button class="stab" data-pane="search" role="tab" title="Search (Ctrl+F)"><span class="ic" data-i="search"></span></button>
      <button class="stab" data-pane="outline" role="tab" title="Contents"><span class="ic" data-i="outline"></span></button>
    </div>
    <div class="pane" id="pane-pages"><div id="selBar" hidden></div><aside id="side" tabindex="0"></aside></div>
    <div class="pane" id="pane-marks" hidden></div>
    <div class="pane" id="pane-search" hidden></div>
    <div class="pane" id="pane-outline" hidden></div>
    <div id="sideGrip" title="Drag to resize"></div>
  </div>
  <section id="wrap"><div id="viewer"></div><div id="msg" hidden></div></section>
</div>
<div id="menuPop" hidden></div>
<div id="selPop" hidden></div>
<div id="notePop" hidden></div>
<div id="toast" hidden></div>
<div id="modalRoot"></div>
`;
