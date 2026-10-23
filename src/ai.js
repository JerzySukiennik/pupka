/* AI island per card (shared chat in the card doc, live steps, stop), edit application as one transaction, selection rewrite. */

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

const STEP = {
  read_card: "Czytam inną kartę", search_images: "Szukam obrazka", find_text: "Szukam tekstu", view_image: "Oglądam obrazek",
  draw_on_image: "Rysuję na obrazku", fill_on_image: "Koloruję obszary", draw_on_card: "Rysuję na kartce", delete_drawings: "Usuwam rysunki", edit_card: "Piszę zmiany w karcie", make_mind_map: "Robię mapę myśli"
};
const SUGGEST = [["spell", "Popraw błędy", "Popraw na tej karcie tylko błędy formalne (wielkie litery, kropki, przecinki, literówki, ortografię). Nie zmieniaj treści; jeśli coś wygląda na błąd merytoryczny, tylko mi to wypisz."], ["wand", "Wyjaśnij prościej", "Wyjaśnij mi ten temat prościej, w kilku zdaniach."], ["layers", "Pytania powtórkowe", "Zrób 5 krótkich pytań powtórkowych z tej karty, z odpowiedziami na końcu."], ["image", "Obrazek do tematu", "Znajdź dobry obrazek do tego tematu i wstaw go w odpowiednie miejsce."]];
const HOVER = matchMedia("(hover: hover)").matches;

export function createAiIsland({ editor, entry, getCard, container, onEdited, draw, undo, insertMind }) {
  const chat = entry.doc.getArray("chat");
  container.className = "isl";
  container.innerHTML = `
    <div class="isl-body">
      <div class="isl-head">${icon("sparkle", 15)}<b>AI</b><span class="isl-sub">wspólny czat tej karty</span><button type="button" class="icon-btn isl-close" title="Zwiń (Esc)">${icon("chevron", 16)}</button></div>
      <div class="ai-msgs"></div>
      <div class="ai-attach"></div>
    </div>
    <span class="isl-ring" aria-hidden="true"></span>
    <form class="isl-bar">
      <span class="isl-mark">${icon("sparkle", 17)}</span>
      <span class="isl-peek"><span class="isl-peek-t">Zapytaj AI</span><kbd>⌘J</kbd></span>
      <textarea rows="1" placeholder="Zapytaj, poproś o poprawkę albo o obrazek…"></textarea>
      <button type="button" class="isl-btn isl-clip" title="Dołącz obraz (albo wklej / przeciągnij)">${icon("clip", 17)}</button>
      <button type="submit" class="isl-send" title="Wyślij (Enter)">${icon("up", 17)}</button>
      <button type="button" class="isl-stop" title="Zatrzymaj (Esc)"><i></i><span>Zatrzymaj</span></button>
    </form>`;
  const body = container.querySelector(".isl-body");
  const msgs = container.querySelector(".ai-msgs");
  const form = container.querySelector(".isl-bar");
  const ta = form.querySelector("textarea");
  const peek = container.querySelector(".isl-peek-t");
  const attachEl = container.querySelector(".ai-attach");
  let busy = false, liveEl = null, lastIdx = -1, attachments = [], pinned = false, hovering = false, unread = false, ctrl = null, stepText = "";

  function wantsOpen() { return pinned || hovering || document.activeElement === ta || ta.value.trim() || attachments.length || container.classList.contains("pointing-busy"); }
  function setOpen(v) {
    const was = container.classList.contains("open");
    container.classList.toggle("open", !!v);
    document.body.classList.toggle("ai-open", !!v);
    if (v && !was) { unread = false; requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; }); }
    if (v !== was) paintPeek();
  }
  let closeTimer = 0;
  function maybeClose() { clearTimeout(closeTimer); closeTimer = setTimeout(() => { if (!wantsOpen()) setOpen(false); }, 380); }
  if (HOVER) {
    let openTimer = 0;
    container.addEventListener("pointerenter", () => { hovering = true; clearTimeout(closeTimer); clearTimeout(openTimer); openTimer = setTimeout(() => { if (hovering) setOpen(true); }, 130); });
    container.addEventListener("pointerleave", () => { hovering = false; clearTimeout(openTimer); maybeClose(); });
  }
  container.addEventListener("click", (e) => { if (!container.classList.contains("open") && !e.target.closest(".isl-stop")) { pinned = true; setOpen(true); ta.focus(); } });
  ta.addEventListener("focus", () => setOpen(true));
  ta.addEventListener("blur", () => maybeClose());
  const onDocDown = (e) => { if (container.contains(e.target) || e.shiftKey || e.target.closest(".page.pointing, .modal-bg")) return; pinned = false; maybeClose(); };
  document.addEventListener("pointerdown", onDocDown, true);
  container.querySelector(".isl-close").addEventListener("click", (e) => { e.stopPropagation(); pinned = false; hovering = false; ta.blur(); setOpen(false); });

  function paintPeek() {
    container.classList.toggle("busy", busy);
    container.classList.toggle("unread", unread && !busy);
    peek.textContent = busy ? (stepText || "Myślę…") : unread ? "Nowa odpowiedź AI" : "Zapytaj AI";
  }

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
  container.querySelector(".isl-clip").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = () => addImageFiles(inp.files);
    inp.click();
  });
  container.querySelector(".isl-stop").addEventListener("click", (e) => { e.stopPropagation(); stop(); });

  function render() {
    const arr = chat.toArray();
    if (arr.length - 1 > lastIdx && lastIdx >= 0 && arr[arr.length - 1].role === "assistant" && !container.classList.contains("open")) unread = true;
    lastIdx = arr.length - 1;
    msgs.innerHTML = arr.map((m, i) => msgHtml(m, i)).join("") || `<div class="ai-empty"><p>Widzę całą tę kartę i mogę czytać inne. Poprawię, dopiszę, wyjaśnię, narysuję albo znajdę obrazek. Shift + obrysuj fragment kartki, żeby mi coś pokazać.</p></div>`;
    msgs.insertAdjacentHTML("beforeend", busy ? "" : `<div class="ai-suggest">${SUGGEST.map(([ic, label], i) => `<button type="button" data-sug="${i}">${icon(ic, 14)}<span>${label}</span></button>`).join("")}</div>`);
    if (liveEl) msgs.appendChild(liveEl);
    msgs.scrollTop = msgs.scrollHeight;
    paintPeek();
  }
  function msgHtml(m, i) {
    if (m.role === "user") return `<div class="msg user"><span class="who"><i style="background:${colorOf(m.name)}"></i>${esc(m.name)}</span><div class="bubble-u">${esc(m.text)}</div>${(m.attachments || []).length ? `<div class="ai-imgs">${m.attachments.map((a) => `<a href="${esc(a.url)}" target="_blank" title="${a.kind === "point" ? "zaznaczenie na kartce" : "obraz"}"><img src="${esc(a.url)}" alt=""></a>`).join("")}</div>` : ""}</div>`;
    const html = mdToHtml(m.text || "");
    const imgs = (m.images || []).map((im) => `<a href="${esc(im.url)}" target="_blank"><img src="${esc(im.url)}" alt=""></a>`).join("");
    const acts = [];
    if (m.edited && i === lastIdx) acts.push(`<button class="ai-undo" type="button">${icon("undo", 13)}<span>Cofnij zmiany AI</span></button>`);
    if (m.text && m.text.trim() && !m.edited) acts.push(`<button class="ai-insert" type="button" data-i="${i}">${icon("plus", 13)}<span>Wstaw do notatki</span></button>`);
    return `<div class="msg ai"><span class="who"><i class="ai-dot"></i>AI${m.name ? " · dla " + esc(m.name) : ""}</span>${(m.steps || []).length ? `<div class="steps">${m.steps.map((t) => `<span class="done">${icon("check", 13)}${esc(t)}</span>`).join("")}</div>` : ""}<div class="ai-text">${html}</div>${imgs ? `<div class="ai-imgs">${imgs}</div>` : ""}${m.edited ? `<div class="ai-note">Zmieniłem kartę.</div>` : ""}${acts.length ? `<div class="ai-acts">${acts.join("")}</div>` : ""}</div>`;
  }
  chat.observe(render);
  render();

  msgs.addEventListener("click", (e) => {
    const sg = e.target.closest("[data-sug]");
    if (sg) { send(SUGGEST[+sg.dataset.sug][2]); return; }
    const u = e.target.closest(".ai-undo");
    if (u) { u.disabled = true; u.querySelector("span").textContent = "Cofnięto"; undo && undo(); draw && draw.rerender(); return; }
    const b = e.target.closest(".ai-insert");
    if (!b) return;
    const m = chat.get(+b.dataset.i);
    if (!m || !editor.isEditable) return;
    const nodes = parseMarkdown(m.text).map((j) => editor.schema.nodeFromJSON(j));
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.insert(end, nodes).scrollIntoView());
    editor.commands.focus("end");
  });

  function autosize() { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; }
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (busy) stop(); else { pinned = false; ta.blur(); hovering = false; setOpen(false); editor.commands.focus(); } }
  });
  ta.addEventListener("paste", (e) => { const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addImageFiles(files); } });
  container.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); container.classList.add("dropping"); setOpen(true); } });
  container.addEventListener("dragleave", (e) => { if (!container.contains(e.relatedTarget)) container.classList.remove("dropping"); });
  container.addEventListener("drop", (e) => { container.classList.remove("dropping"); const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); e.stopPropagation(); addImageFiles(files); } });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let t = ta.value.trim();
    if (!t && attachments.length) t = attachments.some((a) => a.kind === "point") ? "Spójrz na zaznaczony fragment." : "Spójrz na ten obraz.";
    if (t) { ta.value = ""; autosize(); send(t); }
  });

  const gridCache = new Map();
  const IMAGE_TALK = /(obraz|obrazk|map|rysun|narysuj|rysuj|dorysuj|pokoloruj|koloru|kolor|zaznacz|strzał|podpis|zakreśl|wypełn|zamaluj|popraw|na zdjęci|schemat|diagram|ramk|uzupełn)/i;
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

  function stop() { if (busy && ctrl) ctrl.abort(); }

  async function send(text) {
    if (busy) return;
    busy = true;
    ctrl = new AbortController();
    const card = getCard();
    const name = me();
    const pending = attachments; attachments = []; paintAttach();
    const steps = [];
    let current = null;
    liveEl = document.createElement("div");
    liveEl.className = "msg ai live";
    liveEl.innerHTML = `<span class="who"><i class="ai-dot"></i>AI</span><div class="steps"></div><div class="ai-text"></div>`;
    const stepsEl = liveEl.querySelector(".steps");
    const textEl = liveEl.querySelector(".ai-text");
    function paintSteps() {
      stepsEl.innerHTML = steps.map((t) => `<span class="done">${icon("check", 13)}${esc(t)}</span>`).join("") + (current ? `<span class="run"><i class="spin"></i>${esc(current)}</span>` : "");
      stepText = current || (steps.length ? steps[steps.length - 1] : "");
      paintPeek();
      msgs.scrollTop = msgs.scrollHeight;
    }
    function step(t) { if (current && current !== t) steps.push(current); current = t; paintSteps(); }
    function settle() { if (current) { steps.push(current); current = null; paintSteps(); } }
    const sent = [];
    if (pending.length) {
      step("Wysyłam załączniki");
      for (const a of pending) {
        try {
          const file = a.blob instanceof File ? a.blob : new File([a.blob], "zaznaczenie.jpg", { type: a.blob.type || "image/jpeg" });
          const url = await uploadImage(file, name, 1600);
          sent.push({ kind: a.kind, url, blocks: a.blocks || [] });
        } catch (err) { step("Nie udało się wysłać załącznika"); }
        if (a.thumb) URL.revokeObjectURL(a.thumb);
      }
    }
    chat.push([{ role: "user", name, text, ts: Date.now(), attachments: sent }]);
    msgs.appendChild(liveEl);
    const bids = [];
    editor.state.doc.forEach((n) => bids.push(n.attrs && n.attrs.bid));
    const history = chat.toArray().slice(-16).map((m) => ({ role: m.role, content: m.role === "user" ? `${m.name}: ${m.text}${(m.attachments || []).length ? " (z załącznikami)" : ""}` : m.text }));
    const sub = subject(card.subject);
    let acc = "";
    let edited = false;
    const images = [];
    const pendingWork = [];
    let imgsForAI = imagesList();
    const imageTalk = IMAGE_TALK.test(text.replace(/map\S*\s+(myśl|pojęć)\S*/gi, ""));
    if (imgsForAI.length && (imageTalk || sent.some((a) => a.kind === "point"))) {
      step("Przygotowuję obrazki");
      imgsForAI = await gridded(imgsForAI.slice(0, 4)).then((g) => g.concat(imgsForAI.slice(4)));
    }
    step("Czytam kartę");
    if (entry.provider) entry.provider.awareness.setLocalStateField("ai", { by: name });
    let stopped = false;
    try {
      await aiChat({
        messages: history, person: name, subject: sub ? sub.name : "", title: card.title, date: fmtDate(card.date),
        blocks: docToBlocks(editor.state.doc), cards: cardsIndexText(card.id), drawings: draw ? draw.summary() : "",
        attachments: sent,
        visual: imageTalk || sent.length > 0,
        images: imgsForAI,
        imageDrawings: draw ? draw.imageSummary((bid) => { const i = bids.indexOf(bid); return i >= 0 ? i + 1 : 0; }) : ""
      }, (ev) => {
        if (ctrl.signal.aborted) return;
        if (ev.t === "delta") { if (current && !acc) settle(); acc += ev.text; textEl.innerHTML = mdToHtml(acc); msgs.scrollTop = msgs.scrollHeight; }
        else if (ev.t === "tool") step(STEP[ev.name] || "Pracuję");
        else if (ev.t === "status") { const t = ev.text.charAt(0).toUpperCase() + ev.text.slice(1); current = t; paintSteps(); }
        else if (ev.t === "images") { images.push(...(ev.items || [])); }
        else if (ev.t === "draw") { if (!editor.isEditable || !draw) { acc += "\n(Nie mogę rysować na tej karcie.)"; return; } const n = applyDrawing(editor, draw, bids, ev); if (n) edited = true; else acc += "\n(Rysunek nie wyszedł, spróbuj jeszcze raz.)"; }
        else if (ev.t === "image_draw" || ev.t === "image_fill") {
          if (!editor.isEditable || !draw) { acc += "\n(Nie mogę rysować na tej karcie.)"; return; }
          const bid = bids[(ev.block | 0) - 1];
          if (!bid) { acc += "\n(Nie znalazłem obrazka w bloku " + ev.block + ".)"; return; }
          if (ev.t === "image_draw") { const n = draw.addImageShapes(bid, ev.shapes, "AI"); if (n) edited = true; }
          else pendingWork.push(draw.fillImage(bid, ev.fills, "AI").then((r) => { if (r.count) edited = true; if (r.notes && r.notes.length) acc += "\n(" + r.notes.join("; ") + ")"; }).catch((err) => { acc += "\n(" + err.message + ")"; }));
        }
        else if (ev.t === "drawings") { if (!editor.isEditable) { acc += "\n(Nie mogę zmieniać rysunków na cudzej kartce.)"; return; } const n = draw ? draw.clearAll(ev.author, ev.block ? bids[(ev.block | 0) - 1] : null) : 0; if (n) edited = true; }
        else if (ev.t === "mind") {
          if (!editor.isEditable || !insertMind) { acc += "\n(Nie mogę wstawić mapy na tej karcie.)"; return; }
          const n = Math.round(+ev.after_block || 0);
          if (insertMind(n >= 1 ? bids[n - 1] : null, ev.tree)) edited = true;
        }
        else if (ev.t === "edit") {
          if (!editor.isEditable) { acc += "\n(Nie mogę edytować tej karty: to nie twoja kartkówka.)"; return; }
          const n = applyEdits(editor, ev.ops || [], bids);
          if (n) { edited = true; onEdited && onEdited(); }
        } else if (ev.t === "error") { acc += "\n\n⚠️ " + ev.message; }
      }, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted || (e && e.name === "AbortError")) stopped = true;
      else acc += "\n\n⚠️ " + e.message;
    }
    if (pendingWork.length) await Promise.all(pendingWork);
    settle();
    if (stopped) acc = (acc.trim() ? acc.trim() + "\n\n" : "") + "(zatrzymane)";
    liveEl.remove();
    liveEl = null;
    busy = false;
    ctrl = null;
    stepText = "";
    if (!container.classList.contains("open")) unread = true;
    chat.push([{ role: "assistant", name, text: acc.trim(), ts: Date.now(), edited, images: images.slice(0, 3), steps: steps.slice(0, 12) }]);
    if (entry.provider) entry.provider.awareness.setLocalStateField("ai", null);
    render();
  }

  const api = {
    send(t) { setOpen(true); send(t); },
    addAttachment,
    stop,
    isBusy() { return busy; },
    setPointing(v) { container.classList.toggle("pointing-busy", !!v); if (v) setOpen(true); },
    toggle(v) {
      const open = v == null ? !container.classList.contains("open") : v;
      pinned = open;
      setOpen(open);
      if (open) setTimeout(() => ta.focus(), 60); else { ta.blur(); hovering = false; }
    },
    isOpen() { return container.classList.contains("open"); },
    focus() { ta.focus(); },
    destroy() { chat.unobserve(render); stop(); document.removeEventListener("pointerdown", onDocDown, true); clearTimeout(closeTimer); }
  };
  return api;
}

const letters = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^\p{L}\p{N}]/gu, "");
function withinEdits(a, b, k) {
  if (Math.abs(a.length - b.length) > k) return false;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(k + 1);
    cur[0] = i;
    let best = cur[0];
    for (let j = Math.max(1, i - k); j <= Math.min(b.length, i + k); j++) {
      cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), (prev[j] ?? k + 1) + 1, cur[j - 1] + 1);
      if (cur[j] < best) best = cur[j];
    }
    if (best > k) return false;
    prev = cur;
  }
  return prev[b.length] <= k;
}
export function keepsContent(before, after) {
  const nums = (t) => (t.match(/\d+/g) || []).join(",");
  if (nums(before) !== nums(after)) return false;
  const a = letters(before), b = letters(after);
  return withinEdits(a, b, 3 + Math.ceil(a.length * 0.06));
}

export async function rewriteSelection(editor, mode) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  const text = editor.state.doc.textBetween(from, to, "\n");
  if (!text.trim()) return;
  const md = await aiRewrite({ mode, text });
  if (mode === "fix" && !keepsContent(text, md)) throw new Error("poprawka zmieniałaby treść, a nie tylko pisownię i interpunkcję, więc jej nie wstawiłem");
  const blocks = parseMarkdown(md);
  const $from = editor.state.doc.resolve(from), $to = editor.state.doc.resolve(to);
  const sameBlock = $from.sameParent($to) && $from.parent.isTextblock;
  const content = blocks.length === 1 && blocks[0].type === "paragraph" && sameBlock ? blocks[0].content || [] : blocks;
  editor.chain().focus().insertContentAt({ from, to }, content).run();
}
