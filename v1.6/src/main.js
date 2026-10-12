/* Boot: connect the index, pick a person, route by hash, re-render on shared changes. */

import { connectIndex, onChange, me, setMe, purgeOld, NAMES, card, state, warmCard } from "./store.js";
import { renderPicker, renderHome, renderSubject, renderPlan, renderTrash, renderSettings, openSearch } from "./home.js";
import { openCard } from "./card.js";

const root = document.getElementById("app");
const provider = connectIndex();
let current = null;
let currentKey = "";
let picking = false;
let routeToken = 0;

provider.once("sync", () => { setTimeout(purgeOld, 2000); });

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const parts = path.split("/").filter(Boolean);
  return { parts, q };
}

function route(force) {
  if (!me()) return;
  const { parts, q } = parse();
  const key = location.hash;
  if (current && currentKey === key && !force) return;
  if (current && currentKey === key && force && parts[0] === "c" && !current.missing) return;
  if (current) { current.destroy && current.destroy(); current = null; }
  root.innerHTML = "";
  currentKey = key;
  const token = ++routeToken;
  if (parts[0] === "c" && parts[1]) {
    const id = parts[1];
    root.innerHTML = `<div class="empty">Ładuję kartę…</div>`;
    current = { destroy() {}, pending: true };
    warmCard(id).then(() => { if (token === routeToken && me()) current = openCard(root, id); });
  }
  else if (parts[0] === "s" && parts[1]) renderSubject(root, parts[1], q.tab);
  else if (parts[0] === "plan") renderPlan(root);
  else if (parts[0] === "trash") renderTrash(root);
  else if (parts[0] === "settings") renderSettings(root);
  else renderHome(root);
  window.scrollTo(0, 0);
}

function pick() {
  picking = true;
  if (current) { current.destroy && current.destroy(); current = null; }
  root.innerHTML = "";
  currentKey = "";
  renderPicker(root, () => { picking = false; route(true); });
}

window.addEventListener("hashchange", () => route(false));
onChange((kind) => {
  if (picking) return;
  const { parts } = parse();
  if (parts[0] === "c") { if (current && current.missing && card(parts[1])) route(true); return; }
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && !active.closest(".search")) return;
  if (document.querySelector(".modal-bg, .pop-menu")) return;
  route(true);
});
window.addEventListener("pupka:search", openSearch);
window.addEventListener("pupka:switch", pick);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (me()) openSearch(); }
});

root.innerHTML = `<div class="empty">Ładuję…</div>`;
await state.ready;
const saved = sessionStorage.getItem("pupka-me");
if (saved && NAMES.includes(saved)) { setMe(saved); route(true); } else pick();

window.addEventListener("beforeprint", () => document.body.classList.add("printing"));
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
