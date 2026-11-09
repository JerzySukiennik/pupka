/* Floating format bubble over a text selection (and table tools inside a table): marks, block style, font, AI rewrite. */

import { icon } from "./icons.js";
import { FONTS, settings } from "./store.js";
import { rewriteSelection } from "./ai.js";

export function createBubble({ editor, isDrawing, onExplain, toast }) {
  const el = document.createElement("div");
  el.className = "fmt-bubble";
  document.body.appendChild(el);
  let busy = false, menu = null, quietUntil = 0;
  const onCtx = () => { quietUntil = Date.now() + 1500; hide(); };
  editor.view.dom.addEventListener("contextmenu", onCtx);

  function blockLabel() {
    for (const l of [1, 2, 3]) if (editor.isActive("heading", { level: l })) return "Nagłówek " + l;
    return "Tekst";
  }
  function paintText() {
    const on = (n) => (editor.isActive(n) ? " on" : "");
    el.innerHTML = `<button data-c="bold" class="g${on("bold")}" title="Pogrubienie (Cmd+B)">${icon("bold", 16)}</button><button data-c="italic" class="g${on("italic")}" title="Kursywa (Cmd+I)">${icon("italic", 16)}</button><button data-c="underline" class="g${on("underline")}" title="Podkreślenie (Cmd+U)">${icon("underline", 16)}</button><button data-c="strike" class="g${on("strike")}" title="Przekreślenie">${icon("strike", 16)}</button><button data-c="superscript" class="g t${on("superscript")}" title="Indeks górny">x<sup>2</sup></button><button data-c="subscript" class="g t${on("subscript")}" title="Indeks dolny">H<sub>2</sub></button><span class="sep"></span><button data-m="block" class="lab" title="Styl i czcionka">${icon("aa", 16)}<span>${blockLabel()}</span></button><button data-c="bulletList" class="g${on("bulletList")}" title="Lista">${icon("list", 16)}</button><span class="sep"></span><button data-m="ai" class="lab ai" title="AI">${icon("sparkle", 15)}<span>AI</span></button><i class="spin"></i>`;
  }
  function paintTable() {
    el.innerHTML = `<button data-t="addRowAfter" class="lab" title="Dodaj wiersz">${icon("plus", 14)}<span>wiersz</span></button><button data-t="addColumnAfter" class="lab" title="Dodaj kolumnę">${icon("plus", 14)}<span>kolumna</span></button><button data-t="deleteRow" class="lab" title="Usuń wiersz">${icon("minus", 14)}<span>wiersz</span></button><button data-t="deleteColumn" class="lab" title="Usuń kolumnę">${icon("minus", 14)}<span>kolumna</span></button><button data-t="toggleHeaderRow" class="lab" title="Wiersz nagłówka">nagłówek</button><button data-t="deleteTable" class="g danger" title="Usuń tabelę">${icon("trash", 15)}</button>`;
  }
  const SPRING = "cubic-bezier(.34,1.56,.64,1)";
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || !el.animate;
  function intro() {
    el.classList.remove("glide");
    if (!calm()) {
      el.animate([{ opacity: 0, transform: "translateY(10px) scale(.84)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 420, easing: SPRING });
      Array.from(el.children).forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(8px) scale(.7)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 50 + i * 20, easing: SPRING, fill: "backwards" }));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("glide")));
  }
  function hide() { el.classList.remove("on", "glide"); closeMenu(); }
  function place(from, to, below) {
    const a = editor.view.coordsAtPos(from), b = editor.view.coordsAtPos(to);
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = Math.min(a.top, b.top) - h - 10;
    if (below || top < 60) top = Math.max(a.bottom, b.bottom) + 10;
    el.style.top = top + "px";
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, (a.left + b.right) / 2 - w / 2)) + "px";
  }
  function update() {
    if (busy || menu) return;
    const { from, to, empty } = editor.state.selection;
    if (!editor.isEditable || isDrawing() || !editor.view.hasFocus() || Date.now() < quietUntil) { hide(); return; }
    const wasOn = el.classList.contains("on");
    if (empty && editor.isActive("table")) {
      if (el.dataset.kind !== "table") { paintTable(); el.dataset.kind = "table"; }
      let cellStart = from;
      try { const $p = editor.state.doc.resolve(from); for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "table") { cellStart = $p.start(d); break; } } catch (e) { /* stale */ }
      el.classList.add("on");
      const top = editor.view.coordsAtPos(cellStart);
      el.style.top = Math.max(60, top.top - el.offsetHeight - 12) + "px";
      el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, top.left)) + "px";
      if (!wasOn) intro();
      return;
    }
    const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
    if (empty || !text.trim()) { hide(); return; }
    paintText(); el.dataset.kind = "text";
    el.classList.add("on");
    place(from, to);
    if (!wasOn) intro();
  }
  editor.on("selectionUpdate", update);
  editor.on("transaction", () => { if (el.classList.contains("on") && el.dataset.kind === "text" && !menu && !busy) { paintText(); } });
  editor.on("blur", () => setTimeout(() => { if (!busy && !el.matches(":hover") && !(menu && menu.matches(":hover")) && !editor.view.hasFocus()) hide(); }, 160));
  el.addEventListener("mousedown", (e) => e.preventDefault());

  let menuAnchor = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } if (menuAnchor) menuAnchor.classList.remove("menu-open"); menuAnchor = null; }
  function openMenu(anchor, items, onPick) {
    if (menu && menuAnchor === anchor) { closeMenu(); return; }
    closeMenu();
    menuAnchor = anchor;
    anchor.classList.add("menu-open");
    menu = document.createElement("div");
    menu.className = "fmt-menu";
    menu.innerHTML = items.map((it) => (it === "-" ? `<span class="sep"></span>` : `<button data-k="${it[0]}" class="${it[2] || ""}" style="${it[3] || ""}">${it[1]}</button>`)).join("");
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(window.innerWidth - menu.offsetWidth - 8, r.left) + "px";
    menu.style.top = (r.bottom + menu.offsetHeight + 6 > window.innerHeight ? r.top - menu.offsetHeight - 6 : r.bottom + 6) + "px";
    if (!calm()) {
      menu.animate([{ opacity: 0, transform: "translateY(-8px) scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: SPRING });
      Array.from(menu.children).forEach((c, i) => c.animate([{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 30 + i * 28, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }));
    }
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.k; closeMenu(); onPick(k); });
  }
  const onDoc = (e) => { if (menu && !menu.contains(e.target) && !el.contains(e.target)) { closeMenu(); update(); } };
  document.addEventListener("mousedown", onDoc, true);

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || busy) return;
    const ch = editor.chain().focus();
    if (b.dataset.t) { ch[b.dataset.t]().run(); setTimeout(update, 0); return; }
    const c = b.dataset.c;
    if (c) {
      const fn = { bold: "toggleBold", italic: "toggleItalic", underline: "toggleUnderline", strike: "toggleStrike", superscript: "toggleSuperscript", subscript: "toggleSubscript", bulletList: "toggleBulletList" }[c];
      ch[fn]().run();
      return;
    }
    if (b.dataset.m === "block") {
      const cur = editor.getAttributes("textStyle").fontFamily;
      const def = settings.get("font") || "Newsreader";
      openMenu(b, [["p", "Zwykły tekst", blockLabel() === "Tekst" ? "on" : ""], ["1", "Nagłówek 1", blockLabel() === "Nagłówek 1" ? "on h1" : "h1"], ["2", "Nagłówek 2", blockLabel() === "Nagłówek 2" ? "on h2" : "h2"], ["3", "Nagłówek 3", blockLabel() === "Nagłówek 3" ? "on h3" : "h3"], "-"].concat(FONTS.map((f) => ["f:" + f, f, (cur ? cur.replace(/"/g, "") === f : f === def) ? "on" : "", `font-family:"${f}"`])), (k) => {
        const chain = editor.chain().focus();
        if (k === "p") chain.setParagraph().run();
        else if (/^\d$/.test(k)) chain.toggleHeading({ level: +k }).run();
        else if (k.startsWith("f:")) chain.setFontFamily(k.slice(2)).run();
        setTimeout(update, 0);
      });
      return;
    }
    if (b.dataset.m === "ai") {
      openMenu(b, [["fix", `${icon("spell", 15)}<span>Popraw błędy</span>`], ["explain", `${icon("wand", 15)}<span>Wyjaśnij w czacie</span>`], ["expand", `${icon("plus", 15)}<span>Rozwiń</span>`], ["shorten", `${icon("minus", 15)}<span>Skróć</span>`]], async (k) => {
        const { from, to } = editor.state.selection;
        if (k === "explain") { hide(); onExplain(editor.state.doc.textBetween(from, to, "\n")); return; }
        busy = true; el.classList.add("busy");
        try { await rewriteSelection(editor, k); } catch (err) { toast("AI: " + err.message, 5000); }
        busy = false; el.classList.remove("busy"); hide();
      });
    }
  });
  return { hide, destroy() { editor.off("selectionUpdate", update); editor.view.dom.removeEventListener("contextmenu", onCtx); document.removeEventListener("mousedown", onDoc, true); closeMenu(); el.remove(); } };
}
