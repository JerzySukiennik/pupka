/* Boot: connect the index, pick a person, route by hash, re-render on shared changes. */

import { connectIndex, resetLocalIfNeeded, onChange, me, setMe, purgeOld, NAMES, card, state, warmCard, users, touchSubject } from "./store.js";
import { renderPicker, renderHome, renderSubject, renderPlan, renderTrash, renderSettings, openSearch } from "./home.js";
import { openCard } from "./card.js";

const root = document.getElementById("app");
await resetLocalIfNeeded();
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
  if (parts[0] === "s" && parts[1]) touchSubject(parts[1]);
  if (parts[0] === "c" && parts[1]) { const cc = card(parts[1]); if (cc) touchSubject(cc.subject); }
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
  if (me() && state.indexProvider.synced && !(users.get(me()) || {}).color) { pick(); return; }
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
if (saved && NAMES.includes(saved) && (users.get(saved) || {}).color) { setMe(saved); route(true); } else pick();

window.addEventListener("beforeprint", () => document.body.classList.add("printing"));
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));

const WATCH = ["/index.html", "/src/main.js", "/src/card.js", "/src/spell.js", "/src/draw.js", "/src/home.js", "/src/store.js", "/styles.css"];
async function signature() {
  const parts = await Promise.all(WATCH.map((f) => fetch(f, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => "")));
  let h = 0;
  for (const t of parts) { h = (h * 31 + t.length) | 0; for (let i = 0; i < t.length; i += 97) h = (h * 31 + t.charCodeAt(i)) | 0; }
  return parts.every((t) => !t) ? null : String(h);
}
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  let base = null;
  signature().then((sig) => { base = sig; });
  let shown = false;
  const check = async () => {
    if (shown || !base) return;
    const now = await signature();
    if (now && now !== base) {
      shown = true;
      const bar = document.createElement("div");
      bar.className = "update-bar";
      bar.innerHTML = `<span>Jest nowa wersja Pupki.</span><button class="btn small primary">Odśwież</button>`;
      bar.querySelector("button").addEventListener("click", async () => { await Promise.all(WATCH.concat(["/lib/vendor.js"]).map((f) => fetch(f, { cache: "reload" }).catch(() => null))); location.reload(); });
      document.body.appendChild(bar);
    }
  };
  setInterval(check, 4 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}
