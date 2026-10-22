/* AI panel per card (shared chat in the card doc), edit application as one transaction, selection bubble menu. */

import { TextSelection } from "../lib/vendor.js";
import { aiChat, aiRewrite, uploadImage } from "./net.js";
import { parseMarkdown, docToBlocks, mdToHtml, esc } from "./md.js";
import { me, allCards, subject, fmtDate, AI_COLOR, colorOf, uid } from "./store.js";
import { icon } from "./icons.js";

function cardsIndexText(currentId) {
  return allCards().filter((c) => c.id !== currentId && c.kind === "lesson").sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 300)
    .map((c) => { const s = subject(c.subject); return `${c.id} | ${s ? s.name : "?"} | ${c.date || ""} | ${c.title || "(bez tematu)"}`; }).join("\n");
}

export function applyEdits(editor, ops, bids) {
  const doc = editor.state.doc;
  const byBid = new Map();
  doc.forEach((node, pos) => { if (node.attrs && node.attrs.bid) byBid.set(node.attrs.bid, { node, pos }); });
  const targets = [];
  for (const op of ops) {
    const bid = bids[op.block - 1];
    const hit = bid && byBid.get(bid);
    if (!hit && op.op !== "insert_after") continue;
    let nodes = [];
    if (op.op !== "delete") {
      try { nodes = parseMarkdown(op.markdown || "").map((j) => editor.schema.nodeFromJSON(j)); } catch (e) { console.warn("bad block", e, op); continue; }
    }
    if (!hit) { targets.push({ at: doc.content.size, nodes, kind: "insert" }); continue; }
    const from = hit.pos, to = hit.pos + hit.node.nodeSize;
    if (op.op === "replace" && nodes.length && nodes[0].type.spec.attrs && "bid" in nodes[0].type.spec.attrs) nodes[0] = nodes[0].type.create(Object.assign({}, nodes[0].attrs, { bid }), nodes[0].content, nodes[0].marks);
    if (op.op === "replace") targets.push({ from, to, nodes, kind: "replace" });
    else if (op.op === "delete") targets.push({ from, to, nodes: [], kind: "replace" });
    else if (op.op === "insert_after") targets.push({ at: to, nodes, kind: "insert" });
    else if (op.op === "insert_before") targets.push({ at: from, nodes, kind: "insert" });
  }
  if (!targets.length) return 0;
  targets.sort((a, b) => (b.kind === "insert" ? b.at : b.from) - (a.kind === "insert" ? a.at : a.from));
  const tr = editor.state.tr;
  for (const t of targets) {
    if (t.kind === "insert") tr.insert(t.at, t.nodes);
    else if (t.nodes.length) tr.replaceWith(t.from, t.to, t.nodes);
    else tr.delete(t.from, t.to);
  }
  if (tr.doc.content.size === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
  tr.setMeta("addToHistory", true);
  editor.view.dispatch(tr.scrollIntoView());
  return targets.length;
}

export function applyDrawing(editor, draw, bids, ev) {
  const h = Math.max(120, Math.min(700, Math.round(+ev.height || 300)));
  const doc = editor.state.doc;
  let at = doc.content.size, atEnd = true;
  const n = Math.round(+ev.after_block || 0);
  if (n >= 1 && bids[n - 1]) doc.forEach((node, pos) => { if (node.attrs && node.attrs.bid === bids[n - 1]) { at = pos + node.nodeSize; atEnd = false; } });
  const bid = uid();
  const nodes = [editor.schema.nodes.spacer.create({ h, bid })];
  if (atEnd) nodes.push(editor.schema.nodes.paragraph.create());
  editor.view.dispatch(editor.state.tr.insert(at, nodes));
  return draw.addShapes(bid, ev.shapes, { height: h });
}

export function createAiPanel({ editor, entry, getCard, container, onEdited, draw, undo }) {
  const chat = entry.doc.getArray("chat");
  container.innerHTML = `
    <div class="ai-head">${icon("sparkle", 16)}<b>AI</b><span class="ai-sub">wspólny czat tej karty</span><button class="icon-btn ai-close" title="Zamknij (Cmd+J)">${icon("close", 16)}</button></div>
    <div class="ai-msgs"></div>
    <div class="ai-status"></div>
    <div class="ai-attach"></div>
    <form class="ai-form"><button type="button" class="ai-clip" title="Dołącz obraz (albo wklej / przeciągnij)">${icon("image", 16)}</button><textarea rows="1" placeholder="Zapytaj, poproś o poprawkę albo o obrazek…"></textarea><button type="submit" class="ai-send" title="Wyślij (Enter)">${icon("send", 16)}</button></form>
    <div class="ai-hint">Shift + obrysuj fragment kartki, żeby pokazać go AI</div>`;
  const msgs = container.querySelector(".ai-msgs");
  const status = container.querySelector(".ai-status");
  const form = container.querySelector(".ai-form");
  const ta = form.querySelector("textarea");
  let busy = false;
  let liveEl = null;
  let lastIdx = -1;
  const attachEl = container.querySelector(".ai-attach");
  let attachments = [];
  function paintAttach() {
    attachEl.innerHTML = attachments.map((a, i) => `<span class="att${a.pending ? " pending" : ""}"><img src="${a.thumb}" alt=""><span class="att-label">${a.kind === "point" ? (a.blocks && a.blocks.length ? "Zaznaczenie · akapit " + a.blocks.join(", ") : "Zaznaczenie") : "Obraz"}</span><button type="button" data-rm="${i}" title="Usuń">${icon("close", 12)}</button></span>`).join("");
    container.classList.toggle("has-attach", attachments.length > 0);
  }
  attachEl.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; const a = attachments.splice(+b.dataset.rm, 1)[0]; if (a && a.thumb) URL.revokeObjectURL(a.thumb); paintAttach(); });
  function addAttachment(a) {
    if (!a || !a.blob) return;
    if (attachments.length >= 4) attachments.shift();
    attachments.push(a);
    paintAttach();
    api.toggle(true);
  }
  function addImageFiles(files) {
    for (const f of Array.from(files || []).filter((f) => /^image\//.test(f.type)).slice(0, 4)) addAttachment({ kind: "image", blob: f, thumb: URL.createObjectURL(f) });
  }
  container.querySelector(".ai-clip").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = () => addImageFiles(inp.files);
    inp.click();
  });

  function render() {
    const arr = chat.toArray();
    lastIdx = arr.length - 1;
    msgs.innerHTML = arr.map((m, i) => msgHtml(m, i)).join("") || `<div class="ai-empty">Widzę całą tę kartę i mogę czytać inne. Mogę poprawić, dopisać, wyjaśnić albo znaleźć obrazek do tematu i wkleić go w dobre miejsce.<img class="watermark ai-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs"></div>`;
    if (liveEl) msgs.appendChild(liveEl);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function msgHtml(m, i) {
    if (m.role === "user") return `<div class="msg user"><span class="who" style="color:${colorOf(m.name)}">${esc(m.name)}</span>${esc(m.text)}${(m.attachments || []).length ? `<div class="ai-imgs">${m.attachments.map((a) => `<a href="${esc(a.url)}" target="_blank" title="${a.kind === "point" ? "zaznaczenie na kartce" : "obraz"}"><img src="${esc(a.url)}" alt=""></a>`).join("")}</div>` : ""}</div>`;
    const body = mdToHtml(m.text || "");
    const imgs = (m.images || []).map((im) => `<a href="${esc(im.url)}" target="_blank"><img src="${esc(im.url)}" alt=""></a>`).join("");
    return `<div class="msg ai"><span class="who" style="color:${AI_COLOR}">AI${m.name ? " · dla " + esc(m.name) : ""}</span>${body}${imgs ? `<div class="ai-imgs">${imgs}</div>` : ""}${m.edited ? `<div class="ai-note">Zmieniłem kartę.${i === lastIdx ? ` <button class="ai-undo" type="button">Cofnij</button>` : ""}</div>` : ""}${m.text && m.text.trim() && !m.edited ? `<button class="ai-insert" data-i="${i}">Wstaw do notatki</button>` : ""}</div>`;
  }
  chat.observe(render);
  render();

  msgs.addEventListener("click", (e) => {
    const u = e.target.closest(".ai-undo");
    if (u) { u.disabled = true; u.textContent = "Cofnięto"; undo && undo(); draw && draw.rerender(); return; }
    const b = e.target.closest(".ai-insert");
    if (!b) return;
    const m = chat.get(+b.dataset.i);
    if (!m || !editor.isEditable) return;
    const nodes = parseMarkdown(m.text).map((j) => editor.schema.nodeFromJSON(j));
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.insert(end, nodes).scrollIntoView());
    editor.commands.focus("end");
  });
  container.querySelector(".ai-close").addEventListener("click", () => api.toggle(false));

  function autosize() { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; }
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  ta.addEventListener("paste", (e) => { const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addImageFiles(files); } });
  container.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); container.classList.add("dropping"); } });
  container.addEventListener("dragleave", (e) => { if (!container.contains(e.relatedTarget)) container.classList.remove("dropping"); });
  container.addEventListener("drop", (e) => { container.classList.remove("dropping"); const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); e.stopPropagation(); addImageFiles(files); } });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let t = ta.value.trim();
    if (!t && attachments.length) t = attachments.some((a) => a.kind === "point") ? "Spójrz na zaznaczony fragment." : "Spójrz na ten obraz.";
    if (t) { ta.value = ""; autosize(); send(t); }
  });

  const gridCache = new Map();
  const IMAGE_TALK = /(obraz|obrazk|map|rysun|narysuj|rysuj|dorysuj|pokoloruj|koloru|kolor|zaznacz|strzał|podpis|zakreśl|wypełn|zamaluj|popraw|na zdjęci|schemat|diagram)/i;
  async function gridded(list) {
    if (!draw) return list;
    const out = [];
    for (const it of list) {
      const bid = (() => { let n = 0, b = null; editor.state.doc.forEach((node) => { n++; if (n === it.block) b = node.attrs.bid; }); return b; })();
      if (!bid) { out.push(it); continue; }
      const sig = it.url + "|" + draw.imageSig(bid);
      try {
        if (!gridCache.has(sig)) {
          const blob = await draw.imageSnapshot(bid);
          if (blob) gridCache.set(sig, await uploadImage(new File([blob], "siatka.jpg", { type: "image/jpeg" }), me(), 1600));
        }
        out.push(Object.assign({}, it, gridCache.get(sig) ? { grid_url: gridCache.get(sig) } : {}));
      } catch (e) { out.push(it); }
    }
    return out;
  }

  function imagesList() {
    const out = [];
    let n = 0;
    editor.state.doc.forEach((node) => { n++; if (node.type.name === "image" && node.attrs.src) out.push({ block: n, url: node.attrs.src, alt: node.attrs.alt || "" }); });
    return out.slice(0, 20);
  }

  async function send(text) {
    if (busy) return;
    busy = true;
    const card = getCard();
    const name = me();
    const pending = attachments; attachments = []; paintAttach();
    const sent = [];
    if (pending.length) {
      status.textContent = "wysyłam załączniki…";
      for (const a of pending) {
        try {
          const file = a.blob instanceof File ? a.blob : new File([a.blob], "zaznaczenie.jpg", { type: a.blob.type || "image/jpeg" });
          const url = await uploadImage(file, name, 1600);
          sent.push({ kind: a.kind, url, blocks: a.blocks || [] });
        } catch (err) { status.textContent = "nie udało się wysłać załącznika: " + err.message; }
        if (a.thumb) URL.revokeObjectURL(a.thumb);
      }
    }
    chat.push([{ role: "user", name, text, ts: Date.now(), attachments: sent }]);
    const bids = [];
    editor.state.doc.forEach((n) => bids.push(n.attrs && n.attrs.bid));
    const history = chat.toArray().slice(-16).map((m) => ({ role: m.role, content: m.role === "user" ? `${m.name}: ${m.text}${(m.attachments || []).length ? " (z załącznikami)" : ""}` : m.text }));
    const sub = subject(card.subject);
    liveEl = document.createElement("div");
    liveEl.className = "msg ai live";
    liveEl.innerHTML = `<span class="who" style="color:${AI_COLOR}">AI</span><div class="ai-text"></div>`;
    msgs.appendChild(liveEl);
    const textEl = liveEl.querySelector(".ai-text");
    let acc = "";
    let edited = false;
    const images = [];
    const pendingWork = [];
    let imgsForAI = imagesList();
    if (imgsForAI.length && (IMAGE_TALK.test(text) || sent.some((a) => a.kind === "point"))) {
      status.textContent = "przygotowuję obrazki dla AI…";
      imgsForAI = await gridded(imgsForAI.slice(0, 4)).then((g) => g.concat(imgsForAI.slice(4)));
    }
    status.textContent = "myślę…";
    container.classList.add("busy");
    if (entry.provider) entry.provider.awareness.setLocalStateField("ai", { by: name });
    try {
      await aiChat({
        messages: history, person: name, subject: sub ? sub.name : "", title: card.title, date: fmtDate(card.date),
        blocks: docToBlocks(editor.state.doc), cards: cardsIndexText(card.id), drawings: draw ? draw.summary() : "",
        attachments: sent,
        visual: IMAGE_TALK.test(text) || sent.length > 0,
        images: imgsForAI,
        imageDrawings: draw ? draw.imageSummary((bid) => { const i = bids.indexOf(bid); return i >= 0 ? i + 1 : 0; }) : ""
      }, (ev) => {
        if (ev.t === "delta") { acc += ev.text; textEl.innerHTML = mdToHtml(acc); msgs.scrollTop = msgs.scrollHeight; }
        else if (ev.t === "status") status.textContent = ev.text;
        else if (ev.t === "images") { images.push(...(ev.items || [])); }
        else if (ev.t === "draw") { if (!editor.isEditable || !draw) { acc += "\n(Nie mogę rysować na tej karcie.)"; return; } status.textContent = "rysuję"; const n = applyDrawing(editor, draw, bids, ev); if (n) edited = true; else acc += "\n(Rysunek nie wyszedł, spróbuj jeszcze raz.)"; }
        else if (ev.t === "image_draw" || ev.t === "image_fill") {
          if (!editor.isEditable || !draw) { acc += "\n(Nie mogę rysować na tej karcie.)"; return; }
          const bid = bids[(ev.block | 0) - 1];
          if (!bid) { acc += "\n(Nie znalazłem obrazka w bloku " + ev.block + ".)"; return; }
          if (ev.t === "image_draw") { const n = draw.addImageShapes(bid, ev.shapes, "AI"); if (n) edited = true; status.textContent = "rysuję na obrazku"; }
          else {
            status.textContent = "koloruję obszary";
            pendingWork.push(draw.fillImage(bid, ev.fills, "AI").then((r) => { if (r.count) edited = true; if (r.notes && r.notes.length) acc += "\n(" + r.notes.join("; ") + ")"; }).catch((err) => { acc += "\n(" + err.message + ")"; }));
          }
        }
        else if (ev.t === "drawings") { if (!editor.isEditable) { acc += "\n(Nie mogę zmieniać rysunków na cudzej kartce.)"; return; } const n = draw ? draw.clearAll(ev.author, ev.block ? bids[(ev.block | 0) - 1] : null) : 0; if (n) edited = true; status.textContent = n ? "rysunki usunięte" : "nie było rysunków"; }
        else if (ev.t === "edit") {
          if (!editor.isEditable) { acc += "\n(Nie mogę edytować tej karty: to nie twoja kartkówka.)"; return; }
          const n = applyEdits(editor, ev.ops || [], bids);
          if (n) { edited = true; onEdited && onEdited(); }
          status.textContent = "zmiany wprowadzone";
        } else if (ev.t === "error") { acc += "\n\n⚠️ " + ev.message; }
      });
    } catch (e) {
      acc += "\n\n⚠️ " + e.message;
    }
    if (pendingWork.length) await Promise.all(pendingWork);
    liveEl.remove();
    liveEl = null;
    chat.push([{ role: "assistant", name, text: acc.trim(), ts: Date.now(), edited, images: images.slice(0, 3) }]);
    status.textContent = "";
    container.classList.remove("busy");
    if (entry.provider) entry.provider.awareness.setLocalStateField("ai", null);
    busy = false;
    render();
  }

  const api = {
    send,
    addAttachment,
    setPointing(v) { container.classList.toggle("pointing-busy", !!v); status.textContent = v ? "robię zrzut zaznaczenia…" : ""; },
    toggle(v) {
      const open = v == null ? !container.classList.contains("open") : v;
      container.classList.toggle("open", open);
      document.body.classList.toggle("ai-open", open);
      if (open) setTimeout(() => ta.focus(), 50);
    },
    isOpen() { return container.classList.contains("open"); },
    focus() { ta.focus(); },
    destroy() { chat.unobserve(render); }
  };
  return api;
}

export function createSelectionMenu({ editor, aiPanel, isDrawing }) {
  const el = document.createElement("div");
  el.className = "sel-menu";
  el.innerHTML = `<button data-m="explain">Wyjaśnij</button><button data-m="expand">Rozwiń</button><button data-m="fix">Popraw</button><button data-m="shorten">Skróć</button><span class="sel-spin"></span>`;
  document.body.appendChild(el);
  let busy = false;
  let quietUntil = 0;
  const onCtx = () => { quietUntil = Date.now() + 1500; el.classList.remove("on"); };
  editor.view.dom.addEventListener("contextmenu", onCtx);
  function selectedText() {
    const { from, to, empty } = editor.state.selection;
    if (empty) return "";
    return editor.state.doc.textBetween(from, to, "\n");
  }
  function update() {
    if (busy) return;
    const { from, to, empty } = editor.state.selection;
    const text = selectedText();
    if (empty || !text.trim() || text.length < 3 || !editor.isEditable || isDrawing() || !editor.view.hasFocus() || Date.now() < quietUntil) { el.classList.remove("on"); return; }
    const a = editor.view.coordsAtPos(from), b = editor.view.coordsAtPos(to);
    const top = Math.min(a.top, b.top) - 44;
    const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, (a.left + b.left) / 2 - el.offsetWidth / 2));
    el.style.top = Math.max(8, top) + "px";
    el.style.left = left + "px";
    el.classList.add("on");
  }
  editor.on("selectionUpdate", update);
  editor.on("blur", () => setTimeout(() => { if (!busy && !el.matches(":hover")) el.classList.remove("on"); }, 150));
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || busy) return;
    const mode = b.dataset.m;
    const text = selectedText();
    if (!text.trim()) return;
    if (mode === "explain") { el.classList.remove("on"); aiPanel.toggle(true); aiPanel.send(`Wyjaśnij mi ten fragment:\n"${text.slice(0, 2000)}"`); return; }
    busy = true;
    el.classList.add("busy");
    const { from, to } = editor.state.selection;
    try {
      const md = await aiRewrite({ mode, text });
      const blocks = parseMarkdown(md);
      const $from = editor.state.doc.resolve(from), $to = editor.state.doc.resolve(to);
      const sameBlock = $from.sameParent($to) && $from.parent.isTextblock;
      let content;
      if (blocks.length === 1 && blocks[0].type === "paragraph" && sameBlock) content = blocks[0].content || [];
      else content = blocks;
      editor.chain().focus().insertContentAt({ from, to }, content).run();
    } catch (err) {
      alert("AI: " + err.message);
    }
    busy = false;
    el.classList.remove("busy", "on");
  });
  return { destroy() { editor.off("selectionUpdate", update); editor.view.dom.removeEventListener("contextmenu", onCtx); el.remove(); } };
}
