/* Spell checking in the editor: loads the Polish dictionary, underlines unknown words and offers corrections on click. */

import { Extension, Plugin, PluginKey, Decoration, DecorationSet } from "../lib/vendor.js";
import { Speller, wordsIn, matchCase } from "./spellcheck.js";
import { index } from "./store.js";

const KEY = new PluginKey("pupkaSpell");
const dictMap = index.getMap("dict");

let speller = null;
let loading = null;
const listeners = new Set();

export function spellerReady() { return !!speller; }
export function userWords() { return Array.from(dictMap.keys()).sort((a, b) => a.localeCompare(b, "pl")); }
export function removeUserWord(w) { dictMap.delete(w); }

async function fetchCached(url) {
  try {
    const cache = await caches.open("pupka-dict-v1");
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
    const r = await fetch(url);
    if (!r.ok) throw new Error("dict " + r.status);
    try { await cache.put(url, r.clone()); } catch (e) { /* quota */ }
    return await r.arrayBuffer();
  } catch (e) {
    const r = await fetch(url);
    if (!r.ok) throw e;
    return await r.arrayBuffer();
  }
}

export function loadSpeller() {
  if (speller) return Promise.resolve(speller);
  if (loading) return loading;
  const base = new URL("/dist/", location.origin);
  loading = Promise.all([fetchCached(new URL("pl.bloom", base).href), fetchCached(new URL("pl-freq.txt", base).href)])
    .then(([bloom, freq]) => {
      speller = Speller.from(bloom, new TextDecoder().decode(freq));
      speller.setUserWords(userWords());
      listeners.forEach((fn) => fn());
      return speller;
    })
    .catch((e) => { loading = null; console.warn("spell dictionary unavailable", e); return null; });
  return loading;
}

dictMap.observe(() => { if (speller) { speller.setUserWords(userWords()); listeners.forEach((fn) => fn()); } });

function sentenceStart(text, from) {
  let i = from - 1;
  while (i >= 0 && /[\s"„”«»(\[]/.test(text[i])) i--;
  return i < 0 || /[.!?:;\n\u0000]/.test(text[i]);
}

function scan(doc, selection) {
  const ranges = [];
  if (!speller) return ranges;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") return false;
    const text = node.textBetween(0, node.content.size, "\u0000", "\u0000");
    const base = pos + 1;
    for (const w of wordsIn(text)) {
      const word = w.word;
      if (word.length < 2) continue;
      if (word === word.toUpperCase() && word !== word.toLowerCase()) continue;
      if (/\p{Lu}/u.test(word.slice(1))) continue;
      if (/^\p{Lu}/u.test(word) && !sentenceStart(text, w.from)) continue;
      const from = base + w.from, to = base + w.to;
      const at = doc.nodeAt(from);
      if (at && at.marks.some((m) => m.type.name === "code")) continue;
      const parts = word.split(/['’‐-]/).filter(Boolean);
      const bad = parts.length ? parts.some((p) => p.length >= 2 && !speller.ok(p)) : false;
      if (!bad) continue;
      if (selection && selection.empty && selection.from >= from && selection.from <= to && (to === selection.from) && !/[\p{L}]/u.test(text[w.to] || " ")) continue;
      ranges.push({ from, to, word });
    }
    return false;
  });
  return ranges;
}

let popup = null;
export function closeSpellPopup() { if (popup) { popup.remove(); popup = null; } document.removeEventListener("mousedown", onOutside, true); document.removeEventListener("keydown", onEsc, true); }
function onOutside(e) { if (popup && !popup.contains(e.target)) closeSpellPopup(); }
function onEsc(e) { if (e.key === "Escape") { closeSpellPopup(); } }

function showPopup(view, range, x, y) {
  closeSpellPopup();
  const sugg = speller ? speller.suggest(range.word, 5) : [];
  const el = document.createElement("div");
  el.className = "spell-pop";
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  el.innerHTML = `<div class="sp-word">${esc(range.word)}</div>${sugg.length ? sugg.map((s, i) => `<button class="sp-opt" data-i="${i}">${esc(s)}</button>`).join("") : `<div class="sp-none">Brak podpowiedzi</div>`}<div class="sp-sep"></div><button class="sp-act" data-act="add">Dodaj do słownika</button><button class="sp-act" data-act="ignore">Ignoruj</button>`;
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.i != null) {
      const text = sugg[+b.dataset.i];
      const tr = view.state.tr.insertText(text, range.from, range.to);
      view.dispatch(tr);
      view.focus();
    } else if (b.dataset.act === "add") { dictMap.set(range.word.toLowerCase(), true); }
    else if (b.dataset.act === "ignore") { speller.ignore(range.word); listeners.forEach((fn) => fn()); }
    closeSpellPopup();
  });
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
  el.style.top = (y + h + 12 > window.innerHeight ? Math.max(8, y - h - 28) : y + 4) + "px";
  popup = el;
  setTimeout(() => { document.addEventListener("mousedown", onOutside, true); document.addEventListener("keydown", onEsc, true); }, 0);
}

export const Spell = Extension.create({
  name: "pupkaSpell",
  addProseMirrorPlugins() {
    let viewRef = null;
    const rangesAt = (state) => (KEY.getState(state) || { ranges: [] }).ranges;
    const hit = (state, pos) => rangesAt(state).find((r) => pos >= r.from && pos <= r.to);
    return [new Plugin({
      key: KEY,
      state: {
        init: (_, state) => ({ ranges: [], decos: null }),
        apply(tr, prev, oldState, newState) {
          if (!tr.docChanged && !tr.selectionSet && !tr.getMeta(KEY)) return prev;
          const ranges = scan(newState.doc, newState.selection);
          return { ranges };
        }
      },
      props: {
        decorations(state) {
          const ranges = rangesAt(state);
          if (!ranges.length) return null;
          return DecorationSet.create(state.doc, ranges.map((r) => Decoration.inline(r.from, r.to, { class: "misspelled" })));
        },
        handleClick(view, pos, event) {
          if (event.button !== 0 || !view.editable) return false;
          const r = hit(view.state, pos);
          if (!r) return false;
          const a = view.coordsAtPos(r.from), b = view.coordsAtPos(r.to);
          showPopup(view, r, a.left, Math.max(a.bottom, b.bottom));
          return false;
        },
        handleDOMEvents: {
          contextmenu(view, event) {
            if (!view.editable) return false;
            const p = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const r = p && hit(view.state, p.pos);
            if (!r) return false;
            event.preventDefault();
            const a = view.coordsAtPos(r.from), b = view.coordsAtPos(r.to);
            showPopup(view, r, a.left, Math.max(a.bottom, b.bottom));
            return true;
          }
        }
      },
      view(view) {
        viewRef = view;
        const refresh = () => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(KEY, true)); };
        listeners.add(refresh);
        loadSpeller();
        return { destroy() { listeners.delete(refresh); closeSpellPopup(); } };
      }
    })];
  }
});
