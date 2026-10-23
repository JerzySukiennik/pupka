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

const SELF_TEST = ["nie", "się", "jest", "że", "to", "na", "tak", "jak", "ale", "może", "bardzo", "który", "była", "było", "będzie", "szkoła", "człowiek", "lekcja", "książka", "wszystko", "dlatego", "ponieważ", "między", "przed", "przez", "kiedy", "woda", "ziemia", "historia"];
const status = { state: "idle", detail: "", pass: 0, total: SELF_TEST.length, bytes: 0 };
export function spellStatus() { return Object.assign({}, status); }

async function fetchDict(url, fresh) {
  const cache = await caches.open("pupka-dict-v1").catch(() => null);
  if (!fresh && cache) { const hit = await cache.match(url).catch(() => null); if (hit) return { buf: await hit.arrayBuffer(), from: "cache" }; }
  const r = await fetch(url, fresh ? { cache: "reload" } : undefined);
  if (!r.ok) throw new Error("serwer odpowiedział " + r.status);
  const buf = await r.arrayBuffer();
  const want = parseInt(r.headers.get("content-length") || "0", 10);
  if (want && buf.byteLength !== want) throw new Error("plik pobrał się niepełny");
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } })); } catch (e) { /* quota */ } }
  return { buf, from: "sieć" };
}

function check(sp) {
  const expected = Math.ceil(sp.bloom.bits / 32);
  if (sp.bloom.words.length !== expected) return { ok: false, detail: "rozmiar pliku się nie zgadza", pass: 0 };
  const pass = SELF_TEST.filter((w) => sp.bloom.has(w)).length;
  return { ok: pass >= SELF_TEST.length - 2, detail: "test " + pass + "/" + SELF_TEST.length, pass };
}

async function build(fresh) {
  const base = new URL("/dist/", location.origin);
  const [bloom, freq] = await Promise.all([fetchDict(new URL("pl.bloom", base).href, fresh), fetchDict(new URL("pl-freq.txt", base).href, fresh)]);
  const sp = Speller.from(bloom.buf, new TextDecoder().decode(freq.buf));
  const c = check(sp);
  return { sp, c, from: bloom.from, bytes: bloom.buf.byteLength };
}

export function loadSpeller(force) {
  if (speller && !force) return Promise.resolve(speller);
  if (loading && !force) return loading;
  status.state = "loading"; status.detail = "";
  loading = (async () => {
    try {
      let r = await build(!!force);
      if (!r.c.ok && r.from === "cache") r = await build(true);
      status.pass = r.c.pass; status.bytes = r.bytes;
      if (!r.c.ok) { status.state = "broken"; status.detail = r.c.detail; speller = null; listeners.forEach((fn) => fn()); return null; }
      speller = r.sp;
      speller.setUserWords(userWords());
      status.state = "ok"; status.detail = r.c.detail + ", " + r.from;
      listeners.forEach((fn) => fn());
      return speller;
    } catch (e) {
      status.state = "error"; status.detail = String((e && e.message) || e).slice(0, 120);
      loading = null; speller = null; listeners.forEach((fn) => fn());
      return null;
    }
  })();
  return loading;
}

export async function reloadSpeller() {
  try { const cache = await caches.open("pupka-dict-v1"); const keys = await cache.keys(); await Promise.all(keys.map((k) => cache.delete(k))); } catch (e) { /* no cache api */ }
  speller = null; loading = null;
  return loadSpeller(true);
}

dictMap.observe(() => { if (speller) { speller.setUserWords(userWords()); listeners.forEach((fn) => fn()); } });

function sentenceStart(text, from) {
  let i = from - 1;
  while (i >= 0 && /[\s"„”«»(\[]/.test(text[i])) i--;
  return i < 0 || /[.!?:;\n\u0000]/.test(text[i]);
}

function scan(doc, selection) {
  const ranges = [];
  let total = 0;
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
      total++;
      const bad = parts.length ? parts.some((p) => p.length >= 2 && !speller.ok(p)) : false;
      if (!bad) continue;
      if (selection && selection.empty && selection.from >= from && selection.from <= to && (to === selection.from) && !/[\p{L}]/u.test(text[w.to] || " ")) continue;
      ranges.push({ from, to, word });
    }
    return false;
  });
  if (total >= 15 && ranges.length / total > 0.6) return [];
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
