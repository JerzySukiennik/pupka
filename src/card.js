/* Card screen: TipTap editor bound to the card's Yjs doc, tool rail, sibling tabs, format bubble, "/" menu, drawing layer, presence, AI island, print. */

import { Editor, StarterKit, Collaboration, CollaborationCursor, Underline, Subscript, Superscript, Table, TableRow, TableCell, TableHeader, Placeholder, TextStyle, FontFamily, TextAlign, yUndoPluginKey } from "../lib/vendor.js";
import { BlockId, MathNode, Callout, TestHeader, Spacer, ResizableImage, Shortcuts, closeMathPopover } from "./extensions.js";
import { createDraw, COLORS, SIZES } from "./draw.js";
import { createAiIsland } from "./ai.js";
import { uploadImage, importImageUrl } from "./net.js";
import { card as getCard, subject, me, myProfile, profileOf, openCardDoc, closeCardDoc, updateCard, updatePresence, settings, fmtDateLong, listCards, createLesson, state, onChange, uid } from "./store.js";
import { docToPlain, esc } from "./md.js";
import { presenceHtml } from "./ui.js";
import { icon } from "./icons.js";
import { Spell } from "./spell.js";
import { createPointer } from "./point.js";
import { createBubble } from "./bubble.js";
import { createSlash } from "./slash.js";
import { gooey, closeGooey } from "./gooey.js";
import { popMenu } from "./home.js";
import { openMindEditor, mindMarkup, cleanTree } from "./mind.js";

const PAGE_CONTENT_H = 971;
const SHAPES = [["line", "line", "Linia (/)"], ["arrow", "arrow", "Strzałka (A)"], ["rect", "rect", "Prostokąt (R)"], ["ellipse", "ellipse", "Elipsa (O)"]];
const short = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");

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
  const mobile = matchMedia("(max-width: 900px)").matches;
  let shapeTool = localStorage.getItem("pupka-shape") || "rect";
  let mode = "text";

  root.innerHTML = `
    <div class="card-view ${isTest ? "is-test" : ""}">
      <header class="cbar">
        <a class="icon-btn back" href="#/s/${c.subject}${isTest ? "?tab=tests" : ""}" title="Wstecz">${icon("back")}</a>
        <div class="cb-crumb"><a href="#/s/${c.subject}${isTest ? "?tab=tests" : ""}">${esc(sub ? sub.name : "")}</a>${icon("chevronRight", 14)}<span class="card-title">${esc(c.title || (isTest ? c.name : "Nowa lekcja"))}</span></div>
        <div class="cb-r"><div class="presence"></div><button class="icon-btn" data-ui="more" title="Więcej">${icon("more")}</button></div>
      </header>
      <div class="card-body">
        <nav class="rail">
          <button data-mode="text" class="on" title="Pisanie (Esc)">${icon("text")}</button>
          ${canEdit ? `<button data-insert title="Wstaw: obrazek, tabela, wzór, ramka… (albo wpisz / na początku linii)">${icon("plus")}</button>` : ""}
          <span class="rsep"></span>
          <button data-tool="pen" title="Pióro (P, Shift = prosta)">${icon("pen")}</button>
          <button data-tool="hl" title="Zakreślacz (H)">${icon("marker")}</button>
          <button data-tool="eraser" class="more" title="Gumka (E, kliknij jeszcze raz: rodzaj)">${icon("eraser")}</button>
          <button data-tool="lasso" title="Lasso: zaznacz, przesuń, kopiuj (L)">${icon("lasso")}</button>
          <button data-tool="shape" class="more" title="Kształty (kliknij jeszcze raz: wybór)">${icon(shapeTool)}</button>
          <button data-tool="label" title="Tekst na rysunku (T)">${icon("aa")}</button>
          <button data-tool="fill" title="Wiadro: wypełnij obszar na obrazku dokładnie do linii (B)">${icon("bucket")}</button>
          <span class="rsep"></span>
          <button data-goo="color" class="r-color" title="Kolor"><i></i></button>
          <button data-goo="size" class="r-size" title="Grubość (1, 2, 3)"><i></i></button>
          <span class="rsep"></span>
          <button data-draw="undo" title="Cofnij (Cmd+Z)">${icon("undo")}</button>
          <button data-draw="redo" title="Ponów (Cmd+Shift+Z)">${icon("redo")}</button>
          <button data-draw="delete" class="r-del" title="Usuń zaznaczone (Backspace)">${icon("trash")}</button>
          ${isTest && canEdit ? `<span class="rsep"></span><button data-cmd="signature" title="Wstaw mój podpis">${icon("sign")}</button>` : ""}
        </nav>
        <div class="workspace">
          <div class="page">
            <div class="page-head">${esc(fmtDateLong(c.date))}</div>
            <div class="editor" lang="pl"></div>
            <div class="page-breaks"></div>
            <div class="sib"></div>
          </div>
          ${!canEdit ? `<div class="readonly-note">${esc(c.testKind === "sprawdzian" ? "Sprawdzian" : "Kartkówka")} · ${esc(profileOf(c.owner).fullName || c.owner)}. Możesz tylko oglądać, pisze właściciel.</div>` : ""}
        </div>
        <div class="isl"></div>
      </div>
    </div>`;

  const view = root.querySelector(".card-view");
  const pageEl = view.querySelector(".page");
  const editorEl = view.querySelector(".editor");
  const presenceEl = view.querySelector(".presence");
  const titleEl = view.querySelector(".card-title");
  const sibEl = view.querySelector(".sib");
  const rail = view.querySelector(".rail");
  const defaultFont = settings.get("font") || "Newsreader";
  pageEl.style.setProperty("--doc-font", `"${defaultFont}"`);

  const editor = new Editor({
    element: editorEl,
    editable: canEdit,
    autofocus: canEdit && !mobile ? "end" : false,
    editorProps: { attributes: { spellcheck: "false", lang: "pl", class: "doc" }, transformPastedHTML: (html) => html.replace(/<img\b[^>]*>/gi, "") },
    extensions: [
      StarterKit.configure({ history: false, heading: { levels: [1, 2, 3] }, dropcursor: { color: prof.color || "#c96442", width: 2 } }),
      Collaboration.configure({ document: entry.doc, field: "prosemirror" }),
      CollaborationCursor.configure({ provider: entry.provider, user: { name, color: prof.color || "#2f7cf6" } }),
      Underline, Subscript, Superscript, TextStyle, FontFamily, TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: isTest ? "Pisz tutaj…" : "Pisz tutaj. Wpisz / żeby wstawić obrazek, tabelę, wzór albo ramkę." }),
      BlockId, MathNode, Callout, TestHeader, Spacer, Shortcuts, Spell
    ]
  });
  const pmEl = editorEl.querySelector(".ProseMirror");

  const undoManager = yUndoPluginKey.getState(editor.state).undoManager;
  undoManager.addToScope(entry.doc.getMap("strokes"));
  undoManager.addTrackedOrigin("draw");
  const draw = createDraw({ pageEl, pmEl, ydoc: entry.doc, provider: entry.provider, name, color: prof.color || "#111", canEdit: () => canEdit, onChange: syncDrawUi, undoManager });
  pageEl.__draw = draw;
  const ai = createAiIsland({ editor, entry, getCard: () => getCard(id) || c, container: view.querySelector(".isl"), onEdited: () => draw.rerender(), draw, undo: () => editor.commands.undo(), insertMind: (bid, tree) => insertMind(bid, tree) });
  const pointer = createPointer({
    pageEl, pmEl,
    isActive: () => ai.isOpen(),
    onPick: (shot) => { if (shot) ai.addAttachment({ kind: "point", blob: shot.blob, thumb: shot.thumb, blocks: shot.blocks }); else toast("Nie udało się zrobić zrzutu zaznaczenia.", 4000); },
    onBusy: (v) => ai.setPointing(v)
  });
  const bubble = createBubble({ editor, isDrawing: () => draw.isActive(), toast, onExplain: (t) => ai.send(`Wyjaśnij mi ten fragment:\n"${t.slice(0, 2000)}"`) });
  const slash = createSlash({ editor, actions: () => [
    { icon: "image", label: "Obrazek lub gif", keys: "zdjecie foto gif plik", hint: "albo wklej", run: pickImage },
    { icon: "camera", label: "Zdjęcie aparatem", keys: "kamera foto", run: openCamera },
    { icon: "search", label: "Obrazek z internetu (AI)", keys: "google znajdz", run: () => ai.send("Znajdź dobry obrazek do tego tematu i wstaw go w miejsce, gdzie jest kursor.") },
    { icon: "table", label: "Tabela", keys: "tabelka", run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { icon: "formula", label: "Wzór", keys: "matma math latex", hint: "$x^2$", run: () => editor.commands.promptMath() },
    { icon: "box", label: "Ramka: definicja", keys: "callout", hint: "!d", run: () => editor.chain().focus().toggleCallout("definicja").run() },
    { icon: "box", label: "Ramka: ważne", keys: "callout wazne", hint: "!w", run: () => editor.chain().focus().toggleCallout("wazne").run() },
    { icon: "box", label: "Ramka: wzór", keys: "callout", hint: "!z", run: () => editor.chain().focus().toggleCallout("wzor").run() },
    { icon: "heading", label: "Nagłówek", keys: "tytul h1", hint: "#", run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: "list", label: "Lista", keys: "punkty", hint: "-", run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: "listNum", label: "Numeracja", keys: "lista numerowana", hint: "1.", run: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: "quote", label: "Cytat", keys: "", hint: ">", run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: "mind", label: "Mapa myśli", keys: "mapa mysli pojec schemat", run: newMind },
    { icon: "pen", label: "Rysunek", keys: "rysuj szkic", run: () => setMode("draw") },
    { icon: "sign", label: "Mój podpis", keys: "podpis", hidden: !(isTest && canEdit), run: insertSignature }
  ] });

  function setMode(m) {
    if (!canEdit && m === "draw") return;
    mode = m;
    draw.setActive(m === "draw");
    view.classList.toggle("drawing", m === "draw");
    closeMathPopover();
    closeGooey();
    bubble.hide();
    slash.hide();
    if (m === "text") editor.commands.focus(); else editor.view.dom.blur();
    syncDrawUi(draw.getState());
  }
  const isShape = (t) => SHAPES.some((s) => s[0] === t);
  function syncDrawUi(s) {
    if (s.hint) toast(s.hint, 4500);
    rail.querySelector('[data-mode="text"]').classList.toggle("on", mode === "text");
    rail.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", mode === "draw" && (b.dataset.tool === s.tool || (b.dataset.tool === "shape" && isShape(s.tool)))));
    const er = rail.querySelector('[data-tool="eraser"]');
    er.innerHTML = icon(s.eraseMode === "stroke" ? "penOff" : "eraser");
    rail.querySelector(".r-color i").style.background = s.color;
    const sz = rail.querySelector(".r-size i"); sz.style.width = sz.style.height = 4 + s.size * 1.6 + "px";
    rail.querySelector(".r-del").classList.toggle("show", !!s.selection);
    view.classList.toggle("has-sel", !!s.selection);
  }
  syncDrawUi(draw.getState());

  function pickTool(t) { if (mode !== "draw") setMode("draw"); draw.setTool(t); }
  const gooDir = () => (matchMedia("(max-width: 900px)").matches ? "up" : "right");
  rail.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  rail.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const s = draw.getState();
    if (b.dataset.mode) { closeGooey(); setMode("text"); return; }
    if (b.hasAttribute("data-insert")) { if (mode !== "text") setMode("text"); slash.openAtCaret(); return; }
    if (b.dataset.cmd === "signature") { setMode("text"); insertSignature(); return; }
    if (b.dataset.tool === "eraser") {
      if (mode === "draw" && s.tool === "eraser") gooey(b, [
        { key: "part", html: icon("eraser"), title: "Gumka zwykła: ściera kawałek", on: s.eraseMode === "part" },
        { key: "stroke", html: icon("penOff"), title: "Cała kreska naraz", on: s.eraseMode === "stroke" },
        { key: "clear", html: icon("trash"), title: "Wyczyść wszystkie rysunki" }
      ], { dir: gooDir(), onPick: (k) => { if (k === "clear") { if (draw.count() && confirm("Usunąć wszystkie rysunki z tej karty? (Cmd+Z przywraca)")) draw.clearAll(null, null); } else draw.setEraseMode(k); } });
      else pickTool("eraser");
      return;
    }
    if (b.dataset.tool === "shape") {
      if (mode === "draw" && isShape(s.tool)) gooey(b, SHAPES.map(([k, ic, t]) => ({ key: k, html: icon(ic), title: t, on: s.tool === k })), { dir: gooDir(), onPick: (k) => { shapeTool = k; localStorage.setItem("pupka-shape", k); b.innerHTML = icon(k); pickTool(k); } });
      else pickTool(shapeTool);
      return;
    }
    if (b.dataset.tool) { closeGooey(); pickTool(b.dataset.tool); return; }
    if (b.dataset.goo === "color") { gooey(b, COLORS.map((col) => ({ key: col, html: `<i class="sw" style="background:${col}"></i>`, on: col === s.color })), { dir: gooDir(), onPick: (k) => { draw.setColor(k); if (mode !== "draw" && !s.selection) pickTool(s.tool === "eraser" || s.tool === "lasso" || s.tool === "fill" ? "pen" : s.tool); } }); return; }
    if (b.dataset.goo === "size") { gooey(b, SIZES.map((w, i) => ({ key: String(w), html: `<i class="dot" style="width:${4 + w * 1.6}px;height:${4 + w * 1.6}px"></i>`, title: "Grubość " + (i + 1), on: w === s.size })), { dir: gooDir(), onPick: (k) => draw.setSize(+k) }); return; }
    if (b.dataset.draw === "undo") { editor.commands.undo(); draw.rerender(); return; }
    if (b.dataset.draw === "redo") { editor.commands.redo(); draw.rerender(); return; }
    if (b.dataset.draw === "delete") { draw.deleteSelection(); return; }
  });

  view.querySelector(".cbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ui]");
    if (!b) return;
    const a = b.dataset.ui;
    if (a === "ai") ai.toggle();
    else if (a === "print") window.print();
    else if (a === "more") {
      const hidden = document.body.classList.contains("hide-cursors");
      popMenu(b, [
        [hidden ? "Pokaż kursory innych" : "Schowaj kursory innych", () => { document.body.classList.toggle("hide-cursors", !hidden); localStorage.setItem("pupka-cursors", hidden ? "1" : "0"); }],
        [pageEl.classList.contains("show-breaks") ? "Schowaj granice stron A4" : "Pokaż granice stron A4", () => pageEl.classList.toggle("show-breaks")],
        [draw.getState().grid ? "Wyłącz siatkę do rysowania" : "Włącz siatkę do rysowania", () => draw.toggleGrid()]
      ]);
    }
  });

  function blockPos(bid) { let at = null; editor.state.doc.forEach((n, p) => { if (at == null && n.attrs && n.attrs.bid === bid) at = p; }); return at; }
  function insertMind(afterBid, tree, pos) {
    if (!canEdit) return false;
    tree = cleanTree(tree);
    if (!tree.t) return false;
    const W = draw.contentWidth();
    const m = mindMarkup(tree, W);
    const bid = uid();
    const doc = editor.state.doc;
    let at = null, trailing = true;
    if (afterBid) { const p = blockPos(afterBid); if (p != null) at = p + doc.nodeAt(p).nodeSize; }
    if (at == null && typeof pos === "number") {
      try {
        const $p = doc.resolve(Math.min(pos, doc.content.size));
        if ($p.depth >= 1 && $p.node(1).type.name === "paragraph" && !$p.node(1).content.size) { at = $p.before(1); trailing = false; }
        else at = $p.depth >= 1 ? $p.after(1) : pos;
      } catch (e) { at = null; }
    }
    if (at == null) at = doc.content.size;
    const nodes = [editor.schema.nodes.spacer.create({ h: m.H + 16, bid })];
    if (trailing && at >= doc.content.size) nodes.push(editor.schema.nodes.paragraph.create());
    editor.view.dispatch(editor.state.tr.insert(at, nodes));
    draw.putMind(null, bid, tree, W, m.H);
    return true;
  }
  function newMind() {
    const pos = editor.state.selection.from;
    const cur = getCard(id) || c;
    openMindEditor({ tree: { t: cur.title || "Temat", k: [{ t: "Pierwsza gałąź", k: [{ t: "szczegół", k: [] }] }, { t: "Druga gałąź", k: [] }, { t: "Trzecia gałąź", k: [] }] }, width: draw.contentWidth(), onSave: (t) => insertMind(null, t, pos) });
  }
  pmEl.addEventListener("click", (e) => {
    const sp = e.target.closest(".draw-spacer.has-mind");
    if (!sp || mode === "draw" || !canEdit) return;
    const hit = draw.mindAt(sp.dataset.bid);
    if (!hit) return;
    openMindEditor({
      tree: hit.s.tree, width: hit.s.W || draw.contentWidth(),
      onSave: (t) => {
        const W = draw.contentWidth(), m = mindMarkup(t, W);
        draw.putMind(hit.id, hit.s.bid, t, W, m.H);
        const p = blockPos(hit.s.bid);
        if (p != null) { const n = editor.state.doc.nodeAt(p); editor.view.dispatch(editor.state.tr.setNodeMarkup(p, null, Object.assign({}, n.attrs, { h: m.H + 16 }))); }
      },
      onDelete: () => {
        const p = blockPos(hit.s.bid);
        if (p != null) editor.view.dispatch(editor.state.tr.delete(p, p + editor.state.doc.nodeAt(p).nodeSize));
        draw.removeStroke(hit.id);
      }
    });
  });

  function paintSiblings() {
    const cur = getCard(id) || c;
    let list, cls = "";
    if (isTest) { list = listCards(cur.subject, "test").filter((x) => x.group === cur.group); cls = "people"; }
    else {
      const all = listCards(cur.subject, "lesson");
      const i = Math.max(0, all.findIndex((x) => x.id === id));
      list = all.slice(Math.max(0, i - 3), i + 5);
    }
    sibEl.className = "sib " + cls;
    sibEl.innerHTML = (isTest ? "" : `<button class="sib-new" title="Nowa lekcja">${icon("plus", 14)}</button>`) + list.map((x) => `<a href="#/c/${x.id}" class="${x.id === id ? "on" : ""}" title="${esc(x.title || x.name || "bez tematu")}">${isTest ? esc(x.owner) : short(x.date)}</a>`).join("");
  }
  paintSiblings();
  sibEl.addEventListener("click", (e) => { if (e.target.closest(".sib-new")) { e.preventDefault(); location.hash = "#/c/" + createLesson(c.subject); } });
  const offIndex = onChange((k) => { if (k !== "status") paintSiblings(); });

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
      let first = "", img = "";
      doc.forEach((n) => { if (!first && n.isTextblock && n.textContent.trim()) first = n.textContent.trim(); if (!img && n.type.name === "image" && n.attrs.src) img = n.attrs.src; });
      let title = c.title || "";
      const m = /^temat\s*:\s*(.*)$/i.exec(first);
      if (m) title = m[1].trim(); else if (!isTest) title = first.slice(0, 80);
      if (isTest) title = c.name;
      const text = docToPlain(doc);
      updateCard(id, { title, text, img: img || null, updated: Date.now() });
      titleEl.textContent = title || (isTest ? c.name : "Nowa lekcja");
    }, 700);
  }
  editor.on("update", ({ transaction }) => { if (transaction.docChanged) syncTitle(); });
  editor.on("update", () => draw.rerender());

  function renderPresence() {
    const states = [];
    entry.provider.awareness.getStates().forEach((s, cid) => { if (cid !== entry.doc.clientID && s.user) states.push(s); });
    const aiBy = states.find((s) => s.ai) || (entry.provider.awareness.getLocalState() || {}).ai ? true : false;
    presenceEl.innerHTML = presenceHtml(states.map((s) => s.user), 26) + (aiBy ? `<span class="ai-typing" title="AI pracuje">${icon("sparkle", 14)}</span>` : "") + (state.online ? "" : `<span class="offline-pill" title="Zmiany zapiszą się, gdy wróci sieć">${icon("offline", 14)}<span>offline</span></span>`);
  }
  entry.provider.awareness.on("change", renderPresence);
  const offStatus = onChange((k) => { if (k === "status") renderPresence(); });
  renderPresence();
  entry.provider.awareness.setLocalStateField("user", { name, color: prof.color || "#2f7cf6", avatar: prof.avatar });
  updatePresence({ card: id });

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); ai.toggle(); return; }
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
      if (slash.isOpen()) return;
      if (ai.isBusy() && !(mode === "draw" && draw.hasSelection())) { ai.stop(); return; }
      if (ai.isOpen() && document.activeElement?.closest(".isl")) { ai.toggle(false); editor.commands.focus(); return; }
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
    if (k === "e" && draw.getState().tool === "eraser") { e.preventDefault(); draw.setEraseMode(draw.getState().eraseMode === "part" ? "stroke" : "part"); toast(draw.getState().eraseMode === "part" ? "Gumka zwykła" : "Gumka: cała kreska", 1200); return; }
    const map = { p: "pen", h: "hl", e: "eraser", l: "lasso", t: "label", r: "rect", o: "ellipse", a: "arrow", "/": "line", b: "fill" };
    if (map[k]) { e.preventDefault(); if (isShape(map[k])) { shapeTool = map[k]; localStorage.setItem("pupka-shape", shapeTool); rail.querySelector('[data-tool="shape"]').innerHTML = icon(shapeTool); } draw.setTool(map[k]); }
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
      entry.provider.awareness.off("change", renderPresence);
      offStatus();
      offIndex();
      clearTimeout(titleTimer);
      clearTimeout(trimTimer);
      closeMathPopover();
      closeGooey();
      bubble.destroy();
      slash.destroy();
      pointer.destroy();
      ai.destroy();
      draw.destroy();
      editor.destroy();
      updatePresence({ card: null });
      document.body.classList.remove("ai-open");
      closeCardDoc(id);
    }
  };
}
