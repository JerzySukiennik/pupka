/* "/" insert menu: typed at the start of a line (or opened from the rail), filtered as you type, Enter to insert. */

import { icon } from "./icons.js";

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");

export function createSlash({ editor, actions }) {
  const el = document.createElement("div");
  el.className = "slash";
  document.body.appendChild(el);
  let open = false, sel = 0, list = [], range = null, manual = false, manualPos = -1;

  function items() { return actions().filter((a) => !a.hidden); }
  function render(q) {
    const nq = norm(q || "");
    list = items().filter((a) => !nq || norm(a.label + " " + (a.keys || "")).includes(nq));
    if (sel >= list.length) sel = 0;
    el.innerHTML = (q ? `<div class="sl-q">/${q.replace(/[<&]/g, "")}</div>` : `<div class="sl-q">Wstaw</div>`) + (list.length ? list.map((a, i) => `<button type="button" data-i="${i}" class="${i === sel ? "on" : ""}">${icon(a.icon, 16)}<span>${a.label}</span>${a.hint ? `<small>${a.hint}</small>` : ""}</button>`).join("") : `<div class="sl-none">Nic takiego</div>`);
  }
  function placeAt(pos) {
    const c = editor.view.coordsAtPos(pos);
    const h = el.offsetHeight, w = el.offsetWidth;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, c.left)) + "px";
    el.style.top = (c.bottom + h + 12 > window.innerHeight ? c.top - h - 8 : c.bottom + 8) + "px";
  }
  function show(q, pos) { open = true; render(q); el.classList.add("on"); placeAt(pos); }
  function hide() { open = false; manual = false; range = null; el.classList.remove("on"); }

  function detect() {
    if (manual) { if (editor.state.selection.from !== manualPos) hide(); return; }
    const { $from, empty } = editor.state.selection;
    if (!empty || !editor.isEditable || !$from.parent.isTextblock) { if (open) hide(); return; }
    const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
    const m = /^\/([\p{L}\d ]{0,24})$/u.exec(before);
    if (!m) { if (open) hide(); return; }
    range = { from: $from.pos - before.length, to: $from.pos };
    show(m[1], range.from);
  }
  editor.on("update", detect);
  editor.on("selectionUpdate", detect);
  editor.on("blur", () => setTimeout(() => { if (!el.matches(":hover")) hide(); }, 150));

  function choose(i) {
    const a = list[i];
    if (!a) return;
    const r = range;
    hide();
    if (r) editor.chain().focus().deleteRange(r).run(); else editor.commands.focus();
    a.run();
  }
  const onKey = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); sel = (sel + (e.key === "ArrowDown" ? 1 : list.length - 1)) % Math.max(1, list.length); el.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === sel)); el.querySelector("button.on")?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" || e.key === "Tab") { if (list.length) { e.preventDefault(); e.stopPropagation(); choose(sel); } }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hide(); }
  };
  editor.view.dom.addEventListener("keydown", onKey, true);
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) choose(+b.dataset.i); });
  el.addEventListener("pointermove", (e) => { const b = e.target.closest("button"); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; el.querySelectorAll("button").forEach((x, i) => x.classList.toggle("on", i === sel)); } });

  return {
    openAtCaret() { if (!editor.isEditable) return; editor.commands.focus(); manual = true; manualPos = editor.state.selection.from; range = null; sel = 0; show("", manualPos); },
    isOpen: () => open,
    hide,
    destroy() { editor.off("update", detect); editor.off("selectionUpdate", detect); editor.view.dom.removeEventListener("keydown", onKey, true); el.remove(); }
  };
}
