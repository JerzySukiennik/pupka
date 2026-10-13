/* Card screen: TipTap editor bound to the card's Yjs doc, toolbar, drawing layer, presence, AI panel, print. */

import { Editor, StarterKit, Collaboration, CollaborationCursor, Underline, Subscript, Superscript, Table, TableRow, TableCell, TableHeader, Placeholder, TextStyle, FontFamily, TextAlign, yUndoPluginKey } from "../lib/vendor.js";
import { BlockId, MathNode, Callout, TestHeader, Spacer, ResizableImage, Shortcuts, KINDS, closeMathPopover } from "./extensions.js";
import { createDraw, COLORS, SIZES } from "./draw.js";
import { createAiPanel, createSelectionMenu } from "./ai.js";
import { uploadImage, importImageUrl } from "./net.js";
import { card as getCard, subject, me, myProfile, profileOf, openCardDoc, closeCardDoc, updateCard, updatePresence, settings, fmtDateLong, FONTS, trashCard, state, onChange } from "./store.js";
import { docToPlain, esc } from "./md.js";
import { topbar, avatarHtml, presenceHtml } from "./ui.js";
import { icon } from "./icons.js";

const PAGE_CONTENT_H = 971;

export function openCard(root, id) {
  const c = getCard(id);
  if (!c) { root.innerHTML = `<div class="empty">Szukam karty… <a href="#/">Wróć</a></div>`; return { missing: true, destroy() {} }; }
  const sub = subject(c.subject);
  const name = me();
  const prof = myProfile();
  const isTest = c.kind === "test";
  const canEdit = !isTest || c.owner === name;
  const entry = openCardDoc(id);
  const cursorsHidden = localStorage.getItem("pupka-cursors") === "0";
  document.body.classList.toggle("hide-cursors", cursorsHidden);

  root.innerHTML = `
    <div class="card-view ${isTest ? "is-test" : ""}">
      ${topbar({ back: `#/s/${c.subject}${isTest ? "?tab=tests" : ""}`, title: `<span class="crumb">${esc(sub ? sub.name : "")}</span><span class="card-title">${esc(c.title || (isTest ? c.name : "Nowa lekcja"))}</span>`, right: `<div class="presence"></div>` })}
      <div class="toolbar">
        <div class="tb-left">
          <div class="seg mode"><button data-mode="text" class="on" title="Pisanie (Esc)">${icon("text", 16)}<span>Tekst</span></button><button data-mode="draw" title="Rysowanie (Cmd+D)">${icon("pen", 16)}<span>Rysuj</span></button></div>
        </div>
        <div class="tb-scroll">
        <div class="tb-group text-tools">
          <button data-cmd="undo" title="Cofnij (Cmd+Z)">${icon("undo")}</button><button data-cmd="redo" title="Ponów (Cmd+Shift+Z)">${icon("redo")}</button>
          <span class="sep"></span>
          <select class="font-sel" title="Czcionka">${FONTS.map((f) => `<option value="${f}">${f}</option>`).join("")}</select>
          <select class="block-sel" title="Styl akapitu"><option value="p">Zwykły tekst</option><option value="1">Nagłówek 1</option><option value="2">Nagłówek 2</option><option value="3">Nagłówek 3</option></select>
          <span class="sep"></span>
          <button data-cmd="bold" class="glyph" title="Pogrubienie (Cmd+B)"><b>B</b></button><button data-cmd="italic" class="glyph" title="Kursywa (Cmd+I)"><i>I</i></button><button data-cmd="underline" class="glyph" title="Podkreślenie (Cmd+U)"><u>U</u></button><button data-cmd="strike" class="glyph" title="Przekreślenie"><s>S</s></button>
          <button data-cmd="superscript" class="glyph" title="Indeks górny (^x^)">x<sup>2</sup></button><button data-cmd="subscript" class="glyph" title="Indeks dolny (~x~)">H<sub>2</sub></button>
          <span class="sep"></span>
          <button data-cmd="bulletList" title="Lista (- )">${icon("list")}</button><button data-cmd="orderedList" title="Numeracja (1. )">${icon("listNum")}</button><button data-cmd="blockquote" title="Cytat (> )">${icon("quote")}</button>
          <span class="sep"></span>
          <button data-cmd="table" title="Tabela">${icon("table")}</button><button data-cmd="image" title="Obrazek lub gif (albo wklej / przeciągnij)">${icon("image")}</button><button data-cmd="camera" title="Zrób zdjęcie aparatem">${icon("camera")}</button><button data-cmd="math" title="Wzór ($x^2$)">${icon("formula")}</button>
          <div class="dd"><button data-cmd="callout" title="Ramka: definicja, ważne, wzór (!d !w !z)">${icon("box")}</button><div class="dd-menu"><button data-callout="definicja">Definicja</button><button data-callout="wazne">Ważne</button><button data-callout="wzor">Wzór</button></div></div>
          ${isTest && canEdit ? `<span class="sep"></span><button data-cmd="signature" class="labeled" title="Wstaw mój podpis">${icon("sign")}<span>Podpis</span></button>` : ""}
        </div>
        <div class="tb-group draw-tools">
          <button data-tool="pen" class="on" title="Pióro (P, Shift = prosta)">${icon("pen")}</button><button data-tool="hl" title="Zakreślacz (H)">${icon("marker")}</button><button data-tool="eraser" title="Gumka (E)">${icon("eraser")}</button><button data-tool="lasso" title="Lasso: zaznacz, przesuń, kopiuj (L)">${icon("lasso")}</button>
          <span class="sep"></span>
          <button data-tool="line" title="Linia">${icon("line")}</button><button data-tool="arrow" title="Strzałka (A)">${icon("arrow")}</button><button data-tool="rect" title="Prostokąt (R)">${icon("rect")}</button><button data-tool="ellipse" title="Elipsa (O)">${icon("ellipse")}</button><button data-tool="label" title="Tekst na rysunku (T)">${icon("text")}</button>
          <span class="sep"></span>
          <div class="swatches">${COLORS.map((col) => `<button data-color="${col}" style="--c:${col}" title="Kolor"></button>`).join("")}</div>
          <span class="sep"></span>
          <div class="sizes">${SIZES.map((s, i) => `<button data-size="${s}" title="Grubość ${i + 1}"><i style="width:${s + 4}px;height:${s + 4}px"></i></button>`).join("")}</div>
          <span class="sep"></span>
          <button data-draw="undo" title="Cofnij rysunek (Cmd+Z)">${icon("undo")}</button><button data-draw="redo" title="Ponów (Cmd+Shift+Z)">${icon("redo")}</button>
          <button data-draw="grid" title="Siatka pomocnicza (nie drukuje się)">${icon("grid")}</button>
          <button data-draw="delete" title="Usuń zaznaczone (Backspace)">${icon("trash")}</button>
        </div>
        </div>
        <div class="tb-right">
          <button data-ui="cursors" class="${cursorsHidden ? "" : "on"}" title="Pokaż lub schowaj kursory innych">${icon(cursorsHidden ? "eyeOff" : "eye")}</button>
          <button data-ui="breaks" title="Granice stron A4">${icon("pages")}</button>
          <button data-ui="print" title="Drukuj (Cmd+P)">${icon("print")}</button>
          <button data-ui="ai" class="labeled ai-btn" title="Czat AI (Cmd+J)">${icon("sparkle")}<span>AI</span></button>
        </div>
      </div>
      <div class="card-body">
        <div class="workspace">
          <div class="page">
            <div class="page-head">${esc(fmtDateLong(c.date))}</div>
            <div class="editor" lang="pl"></div>
            <div class="page-breaks"></div>
          </div>
          ${!canEdit ? `<div class="readonly-note">${esc(c.testKind === "sprawdzian" ? "Sprawdzian" : "Kartkówka")} · ${esc(profileOf(c.owner).fullName || c.owner)}. Możesz tylko oglądać, pisze właściciel.</div>` : ""}
        </div>
        <aside class="ai-panel"></aside>
      </div>
    </div>`;

  const view = root.querySelector(".card-view");
  const pageEl = view.querySelector(".page");
  const editorEl = view.querySelector(".editor");
  const presenceEl = view.querySelector(".presence");
  const titleEl = view.querySelector(".card-title");
  const defaultFont = settings.get("font") || "Montserrat";
  pageEl.style.setProperty("--doc-font", `"${defaultFont}"`);
  view.querySelector(".font-sel").value = defaultFont;

  const editor = new Editor({
    element: editorEl,
    editable: canEdit,
    autofocus: canEdit ? "end" : false,
    editorProps: { attributes: { spellcheck: "true", lang: "pl", class: "doc" }, transformPastedHTML: (html) => html.replace(/<img\b[^>]*>/gi, "") },
    extensions: [
      StarterKit.configure({ history: false, heading: { levels: [1, 2, 3] }, dropcursor: { color: prof.color || "#2f7cf6", width: 2 } }),
      Collaboration.configure({ document: entry.doc, field: "prosemirror" }),
      CollaborationCursor.configure({ provider: entry.provider, user: { name, color: prof.color || "#2f7cf6" } }),
      Underline, Subscript, Superscript, TextStyle, FontFamily, TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: isTest ? "Pisz tutaj…" : "Pisz tutaj. Skróty: - lista, # nagłówek, !w ramka, $x^2$ wzór" }),
      BlockId, MathNode, Callout, TestHeader, Spacer, Shortcuts
    ]
  });
  const pmEl = editorEl.querySelector(".ProseMirror");

  const undoManager = yUndoPluginKey.getState(editor.state).undoManager;
  undoManager.addToScope(entry.doc.getMap("strokes"));
  undoManager.addTrackedOrigin("draw");
  const draw = createDraw({ pageEl, pmEl, ydoc: entry.doc, provider: entry.provider, name, color: prof.color || "#111", canEdit: () => canEdit, onChange: syncDrawUi, undoManager });
  pageEl.__draw = draw;
  const aiPanel = createAiPanel({ editor, entry, getCard: () => getCard(id) || c, container: view.querySelector(".ai-panel"), onEdited: () => draw.rerender(), draw, undo: () => editor.commands.undo() });
  const selMenu = createSelectionMenu({ editor, aiPanel, isDrawing: () => draw.isActive() });

  let mode = "text";
  function setMode(m) {
    if (!canEdit && m === "draw") return;
    mode = m;
    draw.setActive(m === "draw");
    view.classList.toggle("drawing", m === "draw");
    view.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    closeMathPopover();
    if (m === "text") editor.commands.focus(); else editor.view.dom.blur();
  }
  function syncDrawUi(s) {
    view.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === s.tool));
    view.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === s.color));
    view.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("on", +b.dataset.size === s.size));
    const g = view.querySelector('[data-draw="grid"]'); if (g) g.classList.toggle("on", s.grid);
    const del = view.querySelector('[data-draw="delete"]'); if (del) del.disabled = !s.selection;
  }
  syncDrawUi(draw.getState());

  const toolbar = view.querySelector(".toolbar");
  toolbar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  toolbar.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mode) return setMode(b.dataset.mode);
    if (b.dataset.tool) return draw.setTool(b.dataset.tool);
    if (b.dataset.color) return draw.setColor(b.dataset.color);
    if (b.dataset.size) return draw.setSize(+b.dataset.size);
    if (b.dataset.draw) {
      const a = b.dataset.draw;
      if (a === "undo") draw.undo(); else if (a === "redo") draw.redo(); else if (a === "grid") draw.toggleGrid(); else if (a === "delete") draw.deleteSelection();
      return;
    }
    if (b.dataset.callout) { editor.chain().focus().toggleCallout(b.dataset.callout).run(); return; }
    if (b.dataset.ui) {
      const a = b.dataset.ui;
      if (a === "ai") aiPanel.toggle();
      else if (a === "print") window.print();
      else if (a === "breaks") { pageEl.classList.toggle("show-breaks"); b.classList.toggle("on"); }
      else if (a === "cursors") { const hidden = !document.body.classList.contains("hide-cursors"); document.body.classList.toggle("hide-cursors", hidden); localStorage.setItem("pupka-cursors", hidden ? "0" : "1"); b.classList.toggle("on", !hidden); b.innerHTML = icon(hidden ? "eyeOff" : "eye"); }
      return;
    }
    const cmd = b.dataset.cmd;
    if (!cmd) return;
    const ch = editor.chain().focus();
    if (cmd === "undo") ch.undo().run();
    else if (cmd === "redo") ch.redo().run();
    else if (cmd === "bold") ch.toggleBold().run();
    else if (cmd === "italic") ch.toggleItalic().run();
    else if (cmd === "underline") ch.toggleUnderline().run();
    else if (cmd === "strike") ch.toggleStrike().run();
    else if (cmd === "superscript") ch.toggleSuperscript().run();
    else if (cmd === "subscript") ch.toggleSubscript().run();
    else if (cmd === "bulletList") ch.toggleBulletList().run();
    else if (cmd === "orderedList") ch.toggleOrderedList().run();
    else if (cmd === "blockquote") ch.toggleBlockquote().run();
    else if (cmd === "table") { if (editor.isActive("table")) tableMenu(b); else ch.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }
    else if (cmd === "image") pickImage();
    else if (cmd === "camera") openCamera();
    else if (cmd === "math") editor.commands.promptMath();
    else if (cmd === "callout") b.parentElement.classList.toggle("open");
    else if (cmd === "signature") insertSignature();
  });
  view.querySelector(".font-sel").addEventListener("change", (e) => {
    const f = e.target.value;
    if (editor.state.selection.empty) { settings.set("font", f); pageEl.style.setProperty("--doc-font", `"${f}"`); editor.commands.focus(); }
    else editor.chain().focus().setFontFamily(f).run();
  });
  view.querySelector(".block-sel").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "p") editor.chain().focus().setParagraph().run(); else editor.chain().focus().toggleHeading({ level: +v }).run();
  });
  document.addEventListener("click", closeDd);
  function closeDd(e) { view.querySelectorAll(".dd.open").forEach((d) => { if (!d.contains(e.target)) d.classList.remove("open"); }); }

  function tableMenu(anchor) {
    const m = document.createElement("div");
    m.className = "pop-menu";
    m.innerHTML = `<button data-t="addRowAfter">+ wiersz</button><button data-t="addColumnAfter">+ kolumna</button><button data-t="deleteRow">− wiersz</button><button data-t="deleteColumn">− kolumna</button><button data-t="toggleHeaderRow">nagłówek</button><button data-t="deleteTable" class="danger">usuń tabelę</button>`;
    const r = anchor.getBoundingClientRect();
    m.style.left = r.left + "px"; m.style.top = r.bottom + 6 + "px";
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener("mousedown", onDoc); };
    const onDoc = (e) => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    m.addEventListener("mousedown", (e) => e.preventDefault());
    m.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; editor.chain().focus()[b.dataset.t]().run(); close(); });
  }

  function toast(msg, ms = 3500, busy = false) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast" + (busy ? " busy" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return () => t.remove();
  }

  function insertAfterBlock(src, pos) {
    const doc = editor.state.doc;
    let at = doc.content.size;
    const probe = typeof pos === "number" ? Math.max(0, Math.min(pos, doc.content.size)) : editor.state.selection.to;
    try { const $p = doc.resolve(probe); at = $p.depth >= 1 ? $p.after(1) : probe; } catch (e) { at = doc.content.size; }
    const node = editor.schema.nodes.image.create({ src, alt: "", width: null });
    editor.view.dispatch(editor.state.tr.insert(at, node).scrollIntoView());
  }

  const looksGif = (u) => /\.gif(\?|#|$)/i.test(u) || /(giphy|tenor)\./i.test(u);

  async function ingest({ files = [], urls = [], pos }) {
    const imgs = files.filter((f) => /^image\//.test(f.type));
    const web = urls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 4);
    if (!imgs.length && !web.length) return;
    const done = toast("Wgrywam obrazek…", 0, true);
    const results = [];
    try {
      const gifFile = imgs.find((f) => f.type === "image/gif");
      if (gifFile) results.push(await uploadImage(gifFile, name));
      else if (web.some(looksGif)) {
        try { results.push(await importImageUrl(web.find(looksGif))); }
        catch (e) { if (!imgs.length) throw e; for (const f of imgs) results.push(await uploadImage(f, name)); }
      } else if (imgs.length) for (const f of imgs.slice(0, 6)) results.push(await uploadImage(f, name));
      else for (const u of web) results.push(await importImageUrl(u));
    } catch (e) { done(); toast(e.message || "Nie udało się dodać obrazka.", 6000); return; }
    done();
    results.forEach((src, i) => insertAfterBlock(src, typeof pos === "number" ? pos : undefined));
  }

  function htmlImageUrls(html) {
    if (!html) return [];
    try { return Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("img[src]")).map((i) => i.getAttribute("src")).filter((u) => /^https?:\/\//i.test(u)); } catch (e) { return []; }
  }

  function pickImage() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*,.gif"; inp.multiple = true;
    inp.onchange = () => ingest({ files: Array.from(inp.files || []) });
    inp.click();
  }

  const onPaste = (e) => {
    const cd = e.clipboardData;
    if (!cd || !canEdit) return;
    const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
    const urls = htmlImageUrls(cd.getData("text/html"));
    const plain = (cd.getData("text/plain") || "").trim();
    if (files.length || (urls.length && (!plain || /^https?:\/\/\S+$/.test(plain)))) {
      e.preventDefault(); e.stopPropagation();
      ingest({ files, urls });
    }
  };
  pmEl.addEventListener("paste", onPaste, true);

  const dragHasImage = (dt) => !!dt && (Array.from(dt.types || []).includes("Files") || Array.from(dt.types || []).includes("text/uri-list") || Array.from(dt.types || []).includes("text/html"));
  pageEl.addEventListener("dragover", (e) => { if (canEdit && dragHasImage(e.dataTransfer) && !e.dataTransfer.types.includes("application/x-pm-drag")) { e.preventDefault(); pageEl.classList.add("dropping"); } }, true);
  pageEl.addEventListener("dragleave", (e) => { if (!pageEl.contains(e.relatedTarget)) pageEl.classList.remove("dropping"); });
  pageEl.addEventListener("drop", (e) => {
    pageEl.classList.remove("dropping");
    if (!canEdit || !e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
    const uri = (e.dataTransfer.getData("text/uri-list") || "").split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
    const urls = htmlImageUrls(e.dataTransfer.getData("text/html")).concat(uri.filter((u) => /\.(gif|png|jpe?g|webp)(\?|#|$)/i.test(u) || looksGif(u)));
    if (!files.length && !urls.length) return;
    e.preventDefault(); e.stopPropagation();
    const p = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    ingest({ files, urls: Array.from(new Set(urls)), pos: p ? p.pos : undefined });
  }, true);

  async function openCamera() {
    if (!canEdit) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Ta przeglądarka nie daje dostępu do aparatu. Użyj Chrome, Brave lub Safari.", 6000); return; }
    const bg = document.createElement("div");
    bg.className = "modal-bg cam-bg";
    bg.innerHTML = `<div class="modal cam"><h3>Zdjęcie aparatem</h3><div class="cam-stage"><video autoplay muted playsinline></video><img class="cam-shot" alt="" hidden><div class="cam-msg">Włączam aparat…</div></div><div class="modal-actions"><button class="btn cancel">Anuluj</button><button class="btn retake" hidden>Jeszcze raz</button><button class="btn primary shoot" disabled>Zrób zdjęcie</button></div></div>`;
    document.body.appendChild(bg);
    const video = bg.querySelector("video"), shot = bg.querySelector(".cam-shot"), msg = bg.querySelector(".cam-msg");
    const shoot = bg.querySelector(".shoot"), retake = bg.querySelector(".retake");
    let stream = null, blob = null;
    const close = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); bg.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    bg.querySelector(".cancel").addEventListener("click", close);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      msg.hidden = true; shoot.disabled = false;
    } catch (e) {
      msg.textContent = e && e.name === "NotAllowedError" ? "Brak zgody na aparat. Kliknij ikonę przy adresie strony i zezwól na kamerę, potem otwórz to okno jeszcze raz." : e && e.name === "NotFoundError" ? "Nie widzę aparatu w tym komputerze." : e && e.name === "NotReadableError" ? "Aparat jest zajęty przez inną aplikację." : "Nie udało się włączyć aparatu.";
      return;
    }
    shoot.addEventListener("click", async () => {
      if (blob) {
        shoot.disabled = true; shoot.textContent = "Wgrywam…";
        try {
          const url = await uploadImage(new File([blob], "zdjecie.jpg", { type: "image/jpeg" }), name);
          close();
          insertAfterBlock(url);
        } catch (e) { shoot.disabled = false; shoot.textContent = "Wstaw do karty"; msg.hidden = false; msg.textContent = e.message || "Nie udało się wgrać zdjęcia."; }
        return;
      }
      const c = document.createElement("canvas");
      c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      if (!blob) return;
      shot.src = URL.createObjectURL(blob); shot.hidden = false; video.hidden = true;
      shoot.textContent = "Wstaw do karty"; retake.hidden = false;
    });
    retake.addEventListener("click", () => { blob = null; shot.hidden = true; video.hidden = false; shoot.textContent = "Zrób zdjęcie"; retake.hidden = true; msg.hidden = true; });
  }
  function insertSignature() {
    const sig = myProfile().signature;
    if (!sig) { if (confirm("Nie masz jeszcze podpisu. Narysować go teraz w ustawieniach?")) location.hash = "#/settings"; return; }
    editor.chain().focus().insertContent({ type: "image", attrs: { src: sig, alt: "", width: 180, align: "left" } }).run();
  }

  let titleTimer = null;
  function syncTitle() {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      const doc = editor.state.doc;
      let first = "";
      doc.forEach((n) => { if (!first && n.isTextblock && n.textContent.trim()) first = n.textContent.trim(); });
      let title = c.title || "";
      const m = /^temat\s*:\s*(.*)$/i.exec(first);
      if (m) title = m[1].trim(); else if (!isTest) title = first.slice(0, 80);
      if (isTest) title = c.name;
      const text = docToPlain(doc);
      updateCard(id, { title, text, updated: Date.now() });
      titleEl.textContent = title || (isTest ? c.name : "Nowa lekcja");
    }, 700);
  }
  editor.on("update", ({ transaction }) => { if (transaction.docChanged) syncTitle(); });
  editor.on("transaction", updateToolbarState);
  editor.on("update", () => draw.rerender());
  function updateToolbarState() {
    const map = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", superscript: "superscript", subscript: "subscript", bulletList: "bulletList", orderedList: "orderedList", blockquote: "blockquote", table: "table", callout: "callout" };
    for (const k in map) { const b = view.querySelector(`[data-cmd="${k}"]`); if (b) b.classList.toggle("on", editor.isActive(map[k])); }
    const bs = view.querySelector(".block-sel");
    bs.value = editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "p";
    const ff = editor.getAttributes("textStyle").fontFamily;
    const fs = view.querySelector(".font-sel");
    if (ff && FONTS.includes(ff.replace(/"/g, ""))) fs.value = ff.replace(/"/g, ""); else if (!document.activeElement || document.activeElement !== fs) fs.value = settings.get("font") || "Montserrat";
  }

  function renderPresence() {
    const states = [];
    entry.provider.awareness.getStates().forEach((s, cid) => { if (cid !== entry.doc.clientID && s.user) states.push(s); });
    const aiBy = states.find((s) => s.ai) || (entry.provider.awareness.getLocalState() || {}).ai ? true : false;
    presenceEl.innerHTML = presenceHtml(states.map((s) => s.user)) + (aiBy ? `<span class="ai-typing" title="AI pracuje">✦</span>` : "") + `<span class="net ${state.online ? "on" : ""}" title="${state.online ? "połączono" : "offline, zmiany zapiszą się po powrocie sieci"}"></span>`;
  }
  entry.provider.awareness.on("change", renderPresence);
  const offStatus = onChange((k) => { if (k === "status") renderPresence(); });
  renderPresence();
  entry.provider.awareness.setLocalStateField("user", { name, color: prof.color || "#2f7cf6", avatar: prof.avatar });
  updatePresence({ card: id });

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); aiPanel.toggle(); return; }
    if (mod && e.key.toLowerCase() === "z" && canEdit) {
      const el = document.activeElement;
      const inPM = !!(el && el.closest && el.closest(".ProseMirror"));
      const field = !!el && (/^(INPUT|SELECT)$/.test(el.tagName) || (el.tagName === "TEXTAREA" && !!el.value) || (el.isContentEditable && !inPM));
      if (!inPM && !field) {
        e.preventDefault();
        if (e.shiftKey) editor.commands.redo(); else editor.commands.undo();
        draw.rerender();
        return;
      }
    }
    if (mod && (e.key.toLowerCase() === "d" || e.key.toLowerCase() === "e") && !e.shiftKey && canEdit) { e.preventDefault(); setMode(mode === "draw" ? "text" : "draw"); return; }
    if (e.key === "Escape") {
      if (aiPanel.isOpen() && document.activeElement?.closest(".ai-panel")) { aiPanel.toggle(false); editor.commands.focus(); return; }
      if (mode === "draw") { if (draw.hasSelection()) draw.clearSelection(); else setMode("text"); }
      return;
    }
    if (mode !== "draw") return;
    if (typing && !document.activeElement.closest(".draw-layer")) return;
    if (document.activeElement?.classList?.contains("draw-label-input")) return;
    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); draw.copySelection(); return; }
    if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); draw.paste(); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); draw.setTool("lasso"); draw.selectAll(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && draw.hasSelection()) { e.preventDefault(); draw.deleteSelection(); return; }
    if (e.key === " ") { draw.setSpace(true); return; }
    if (mod) return;
    const k = e.key.toLowerCase();
    const map = { p: "pen", h: "hl", e: "eraser", l: "lasso", t: "label", r: "rect", o: "ellipse", a: "arrow", "/": "line" };
    if (map[k]) { e.preventDefault(); draw.setTool(map[k]); }
    else if (["1", "2", "3"].includes(k)) draw.setSize(SIZES[+k - 1]);
  }
  function onKeyUp(e) { if (e.key === " ") draw.setSpace(false); }
  const onBeforePrint = () => draw.printPrepare();
  const onAfterPrint = () => draw.printCleanup();
  window.addEventListener("beforeprint", onBeforePrint);
  window.addEventListener("afterprint", onAfterPrint);
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

  pageEl.style.setProperty("--page-h", PAGE_CONTENT_H + "px");

  function trimLeadingBlanks() {
    if (!canEdit || editor.isDestroyed) return;
    const doc = editor.state.doc;
    let end = 0, lead = 0, hasContent = false;
    doc.forEach((n, off) => {
      if (hasContent) return;
      if (n.type.name === "paragraph" && n.content.size === 0) { lead++; end = off + n.nodeSize; } else hasContent = true;
    });
    if (lead && hasContent) editor.view.dispatch(editor.state.tr.delete(0, end));
  }
  const trimTimer = setTimeout(trimLeadingBlanks, 2200);

  return {
    destroy() {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      draw.printCleanup();
      pmEl.removeEventListener("paste", onPaste, true);
      document.removeEventListener("click", closeDd);
      entry.provider.awareness.off("change", renderPresence);
      offStatus();
      clearTimeout(titleTimer);
      clearTimeout(trimTimer);
      closeMathPopover();
      selMenu.destroy();
      aiPanel.destroy();
      draw.destroy();
      editor.destroy();
      updatePresence({ card: null });
      document.body.classList.remove("ai-open");
      closeCardDoc(id);
    }
  };
}
