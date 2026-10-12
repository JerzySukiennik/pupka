/* AI panel per card (shared chat in the card doc), edit application as one transaction, selection bubble menu. */

import { TextSelection } from "../lib/vendor.js";
import { aiChat, aiRewrite } from "./net.js";
import { parseMarkdown, docToBlocks, mdToHtml, esc } from "./md.js";
import { me, allCards, subject, fmtDate, AI_COLOR, colorOf } from "./store.js";

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

export function createAiPanel({ editor, entry, getCard, container, onEdited }) {
  const chat = entry.doc.getArray("chat");
  container.innerHTML = `
    <div class="ai-head"><span class="ai-dot"></span><b>AI</b><span class="ai-sub">Haiku 5.5 · wspólny czat tej karty</span><button class="icon-btn ai-close" title="Zamknij (Cmd+J)">✕</button></div>
    <div class="ai-msgs"></div>
    <div class="ai-status"></div>
    <form class="ai-form"><textarea rows="1" placeholder="Zapytaj, poproś o poprawkę albo o obrazek…"></textarea><button type="submit" class="ai-send" title="Wyślij (Enter)">➤</button></form>`;
  const msgs = container.querySelector(".ai-msgs");
  const status = container.querySelector(".ai-status");
  const form = container.querySelector(".ai-form");
  const ta = form.querySelector("textarea");
  let busy = false;
  let liveEl = null;

  function render() {
    const arr = chat.toArray();
    msgs.innerHTML = arr.map((m, i) => msgHtml(m, i)).join("") || `<div class="ai-empty">Widzę całą tę kartę i mogę czytać inne. Mogę poprawić, dopisać, wyjaśnić albo znaleźć obrazek do tematu i wkleić go w dobre miejsce.<img class="watermark ai-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs"></div>`;
    if (liveEl) msgs.appendChild(liveEl);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function msgHtml(m, i) {
    if (m.role === "user") return `<div class="msg user"><span class="who" style="color:${colorOf(m.name)}">${esc(m.name)}</span>${esc(m.text)}</div>`;
    const body = mdToHtml(m.text || "");
    const imgs = (m.images || []).map((im) => `<a href="${esc(im.url)}" target="_blank"><img src="${esc(im.url)}" alt=""></a>`).join("");
    return `<div class="msg ai"><span class="who" style="color:${AI_COLOR}">AI${m.name ? " · dla " + esc(m.name) : ""}</span>${body}${imgs ? `<div class="ai-imgs">${imgs}</div>` : ""}${m.edited ? `<div class="ai-note">Zmieniłem kartę. Cmd+Z cofa.</div>` : ""}${m.text && m.text.trim() && !m.edited ? `<button class="ai-insert" data-i="${i}">Wstaw do notatki</button>` : ""}</div>`;
  }
  chat.observe(render);
  render();

  msgs.addEventListener("click", (e) => {
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
  form.addEventListener("submit", (e) => { e.preventDefault(); const t = ta.value.trim(); if (t) { ta.value = ""; autosize(); send(t); } });

  async function send(text) {
    if (busy) return;
    busy = true;
    const card = getCard();
    const name = me();
    chat.push([{ role: "user", name, text, ts: Date.now() }]);
    const bids = [];
    editor.state.doc.forEach((n) => bids.push(n.attrs && n.attrs.bid));
    const history = chat.toArray().slice(-16).map((m) => ({ role: m.role, content: m.role === "user" ? `${m.name}: ${m.text}` : m.text }));
    const sub = subject(card.subject);
    liveEl = document.createElement("div");
    liveEl.className = "msg ai live";
    liveEl.innerHTML = `<span class="who" style="color:${AI_COLOR}">AI</span><div class="ai-text"></div>`;
    msgs.appendChild(liveEl);
    const textEl = liveEl.querySelector(".ai-text");
    let acc = "";
    let edited = false;
    const images = [];
    status.textContent = "myślę…";
    container.classList.add("busy");
    if (entry.provider) entry.provider.awareness.setLocalStateField("ai", { by: name });
    try {
      await aiChat({
        messages: history, person: name, subject: sub ? sub.name : "", title: card.title, date: fmtDate(card.date),
        blocks: docToBlocks(editor.state.doc), cards: cardsIndexText(card.id)
      }, (ev) => {
        if (ev.t === "delta") { acc += ev.text; textEl.innerHTML = mdToHtml(acc); msgs.scrollTop = msgs.scrollHeight; }
        else if (ev.t === "status") status.textContent = ev.text;
        else if (ev.t === "images") { images.push(...(ev.items || [])); }
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
  function selectedText() {
    const { from, to, empty } = editor.state.selection;
    if (empty) return "";
    return editor.state.doc.textBetween(from, to, "\n");
  }
  function update() {
    if (busy) return;
    const { from, to, empty } = editor.state.selection;
    const text = selectedText();
    if (empty || !text.trim() || text.length < 3 || !editor.isEditable || isDrawing() || !editor.view.hasFocus()) { el.classList.remove("on"); return; }
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
  return { destroy() { editor.off("selectionUpdate", update); el.remove(); } };
}
