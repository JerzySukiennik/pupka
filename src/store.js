/* Shared state: the index document (subjects, cards, users, settings, plan) and card documents, all Yjs + IndexedDB + WebSocket. */

import { Y, WebsocketProvider, IndexeddbPersistence } from "../lib/vendor.js";
import { WS } from "./net.js";

export const EPOCH = 3;
export const INDEX_ROOM = EPOCH > 1 ? `index-e${EPOCH}` : "index";
export const NAMES = ["Jurek", "Janek", "Jaś"];
export const CLASS = "8K";
export const PALETTE = ["#2f7cf6", "#1fa463", "#f28c28", "#a855f7", "#0fb5c9", "#e0457b", "#8d6e3f", "#111111"];
export const AI_COLOR = "#a855f7";
export const FONTS = ["Newsreader", "Geist", "Montserrat", "Inter", "Jurek Hand", "Arial", "Georgia", "Times New Roman", "Courier New"];
export const DEFAULT_HOURS = ["8:00", "8:55", "9:50", "10:45", "11:50", "12:45", "13:40", "14:35", "15:30"];
export const DAYS = ["Pon", "Wt", "Śr", "Czw", "Pt"];

export const index = new Y.Doc();
export const subjects = index.getMap("subjects");
export const cards = index.getMap("cards");
export const users = index.getMap("users");
export const settings = index.getMap("settings");
export const plan = index.getMap("plan");

export const state = { me: null, indexProvider: null, online: false, showOffline: false, paused: false, listeners: new Set() };

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function today() { const d = new Date(); return d.toISOString().slice(0, 10); }
export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${String(m).padStart(2, "0")}.${y}`;
}
export function fmtDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
  return `${d} ${months[m - 1]} ${y}`;
}

export async function resetLocalIfNeeded() {
  let have = null;
  try { have = localStorage.getItem("pupka-epoch"); } catch (e) { /* storage blocked */ }
  if (have === String(EPOCH)) return false;
  try {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    await Promise.all(dbs.filter((d) => d.name && d.name.startsWith("pupka-")).map((d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); setTimeout(res, 1500); })));
  } catch (e) { /* best effort */ }
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("pupka-")).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    localStorage.setItem("pupka-epoch", String(EPOCH));
  } catch (e) { /* storage blocked */ }
  return true;
}

export function connectIndex() {
  if (state.indexProvider) return state.indexProvider;
  const idb = new IndexeddbPersistence("pupka-index-e" + EPOCH, index);
  const p = new WebsocketProvider(WS, INDEX_ROOM, index, { maxBackoffTime: 8000 });
  state.ready = Promise.race([
    idb.whenSynced.then(() => (index.getMap("subjects").size ? null : new Promise((res) => { p.once("sync", res); setTimeout(res, 2500); }))),
    new Promise((res) => setTimeout(res, 4000))
  ]);
  p.on("status", ({ status }) => setConnected(status === "connected"));
  state.indexProvider = p;
  index.on("update", () => emit("index"));
  return p;
}

let offTimer = 0;
function setConnected(v) {
  const was = state.online;
  state.online = v;
  if (v) { clearTimeout(offTimer); offTimer = 0; if (!was || state.showOffline) { state.showOffline = false; emit("status"); } return; }
  if (was) emit("status");
  if (offTimer || state.showOffline) return;
  offTimer = setTimeout(() => { offTimer = 0; if (!state.online && !state.paused) { state.showOffline = true; emit("status"); } }, 5000);
}
export function offlineLabel() { return navigator.onLine === false ? "offline" : "bez synchronizacji"; }
export function offlineTitle() { return navigator.onLine === false ? "Nie ma internetu. Zmiany zapisują się na tym urządzeniu i wyślą się same, gdy wróci sieć." : "Serwer Pupki chwilowo nie odpowiada. Zmiany zapisują się na tym urządzeniu i wyślą się same, gdy wróci połączenie."; }
window.addEventListener("offline", () => { state.showOffline = true; emit("status"); });
let pauseTimer = 0;
const liveProviders = () => [state.indexProvider].concat(Array.from(docCache.values()).map((e) => e.provider)).filter(Boolean);
document.addEventListener("visibilitychange", () => {
  clearTimeout(pauseTimer);
  if (document.hidden) pauseTimer = setTimeout(() => { state.paused = true; liveProviders().forEach((p) => p.disconnect()); }, 45000);
  else if (state.paused) { state.paused = false; liveProviders().forEach((p) => p.connect()); setConnected(state.online); }
});

export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
let emitTimer = null;
let pendingKinds = new Set();
function emit(kind) {
  pendingKinds.add(kind);
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const kinds = Array.from(pendingKinds);
    pendingKinds = new Set();
    for (const k of kinds) state.listeners.forEach((fn) => { try { fn(k); } catch (e) { console.error(e); } });
  }, 30);
}

export function setMe(name) {
  state.me = name;
  sessionStorage.setItem("pupka-me", name);
  updatePresence();
}
export function me() { return state.me; }
export function myProfile() { return (state.me && users.get(state.me)) || {}; }
export function profileOf(name) { return users.get(name) || {}; }
export function colorOf(name) { return profileOf(name).color || "#888"; }

export function updatePresence(extra = {}) {
  if (!state.indexProvider || !state.me) return;
  const p = myProfile();
  state.indexProvider.awareness.setLocalStateField("user", { name: state.me, color: p.color, avatar: p.avatar });
  for (const k of Object.keys(extra)) state.indexProvider.awareness.setLocalStateField(k, extra[k]);
}

export function presence() {
  if (!state.indexProvider) return [];
  const out = [];
  const myId = index.clientID;
  state.indexProvider.awareness.getStates().forEach((s, id) => { if (s.user && id !== myId) out.push(Object.assign({ clientId: id }, s)); });
  return out;
}

export function listSubjects(includeDeleted = false) {
  const out = [];
  subjects.forEach((s, id) => { if (includeDeleted || !s.deleted) out.push(Object.assign({ id }, s)); });
  return out.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.created || 0) - (b.created || 0));
}
function openedKey() { return "pupka-opened-" + (state.me || "x"); }
function openedMap() { try { return JSON.parse(localStorage.getItem(openedKey()) || "{}"); } catch (e) { return {}; } }
export function touchSubject(sid) {
  if (!sid || !state.me) return;
  try { const m = openedMap(); m[sid] = Date.now(); localStorage.setItem(openedKey(), JSON.stringify(m)); } catch (e) { /* storage blocked */ }
}
export function rankedSubjects() {
  const opened = openedMap();
  const latest = {};
  cards.forEach((c) => { if (!c.deleted && c.subject) latest[c.subject] = Math.max(latest[c.subject] || 0, c.updated || c.created || 0); });
  return listSubjects().sort((a, b) => (opened[b.id] || 0) - (opened[a.id] || 0) || (latest[b.id] || 0) - (latest[a.id] || 0) || (a.order || 0) - (b.order || 0));
}
export function listCards(subjectId, kind) {
  const out = [];
  cards.forEach((c, id) => { if (c.subject === subjectId && !c.deleted && (!kind || c.kind === kind)) out.push(Object.assign({ id }, c)); });
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0));
}
export function allCards() {
  const out = [];
  cards.forEach((c, id) => { if (!c.deleted) out.push(Object.assign({ id }, c)); });
  return out;
}
export function card(id) { const c = cards.get(id); return c ? Object.assign({ id }, c) : null; }
export function subject(id) { const s = subjects.get(id); return s ? Object.assign({ id }, s) : null; }

export function createSubject(name, emoji) {
  const id = uid();
  const order = listSubjects(true).length;
  subjects.set(id, { name, emoji: emoji || "", order, created: Date.now() });
  return id;
}
export function updateSubject(id, patch) { const s = subjects.get(id); if (s) subjects.set(id, Object.assign({}, s, patch)); }
export function reorderSubjects(ids) { ids.forEach((id, i) => updateSubject(id, { order: i })); }

export function createCard(data) {
  const id = uid();
  cards.set(id, Object.assign({ created: Date.now(), updated: Date.now(), by: state.me, title: "" }, data));
  return id;
}
export function updateCard(id, patch) {
  const c = cards.get(id);
  if (!c) return;
  let changed = false;
  for (const k of Object.keys(patch)) if (c[k] !== patch[k]) changed = true;
  if (changed) cards.set(id, Object.assign({}, c, patch));
}
export function trashCard(id) { updateCard(id, { deleted: Date.now() }); }
export function restoreCard(id) { const c = cards.get(id); if (c) { const n = Object.assign({}, c); delete n.deleted; cards.set(id, n); } }
export function trashSubject(id) { updateSubject(id, { deleted: Date.now() }); }
export function restoreSubject(id) { const s = subjects.get(id); if (s) { const n = Object.assign({}, s); delete n.deleted; subjects.set(id, n); } }
export function purgeOld() {
  const cutoff = Date.now() - 30 * 864e5;
  index.transact(() => {
    cards.forEach((c, id) => { if (c.deleted && c.deleted < cutoff) cards.delete(id); });
    subjects.forEach((s, id) => { if (s.deleted && s.deleted < cutoff) subjects.delete(id); });
  });
}
export function trashItems() {
  const out = [];
  cards.forEach((c, id) => { if (c.deleted) out.push(Object.assign({ id, type: "card" }, c)); });
  subjects.forEach((s, id) => { if (s.deleted) out.push(Object.assign({ id, type: "subject" }, s)); });
  return out.sort((a, b) => b.deleted - a.deleted);
}

const docCache = new Map();
export function openCardDoc(id) {
  if (docCache.has(id)) { const e = docCache.get(id); e.refs++; return e; }
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence("pupka-card-" + id, doc);
  const provider = new WebsocketProvider(WS, "card:" + id, doc, { maxBackoffTime: 8000 });
  const entry = { doc, idb, provider, refs: 1, id };
  docCache.set(id, entry);
  return entry;
}
export function closeCardDoc(id) {
  const e = docCache.get(id);
  if (!e) return;
  e.refs--;
  if (e.refs > 0) return;
  setTimeout(() => {
    const cur = docCache.get(id);
    if (!cur || cur.refs > 0) return;
    cur.provider.destroy();
    cur.idb.destroy();
    cur.doc.destroy();
    docCache.delete(id);
  }, 4000);
}

export function warmCard(id) {
  const e = openCardDoc(id);
  const frag = e.doc.getXmlFragment("prosemirror");
  const idb = Promise.race([e.idb.whenSynced, new Promise((r) => setTimeout(r, 1500))]);
  const net = () => frag.length ? null : new Promise((res) => { if (e.provider.synced) return res(); e.provider.once("sync", res); setTimeout(res, 2500); });
  return idb.then(net).then(() => { closeCardDoc(id); });
}

function xmlParagraph(text) {
  const p = new Y.XmlElement("paragraph");
  if (text) { const t = new Y.XmlText(); t.insert(0, text); p.insert(0, [t]); }
  return p;
}

export function seedLesson(entry) {
  const frag = entry.doc.getXmlFragment("prosemirror");
  if (frag.length) return;
  entry.doc.transact(() => { frag.insert(0, [xmlParagraph("Temat: "), xmlParagraph("")]); });
}

export function seedTest(entry, attrs) {
  const frag = entry.doc.getXmlFragment("prosemirror");
  if (frag.length) return;
  entry.doc.transact(() => {
    const h = new Y.XmlElement("testHeader");
    for (const k of Object.keys(attrs)) h.setAttribute(k, String(attrs[k] == null ? "" : attrs[k]));
    frag.insert(0, [h, xmlParagraph(""), xmlParagraph("")]);
  });
}

export function createLesson(subjectId) {
  const id = createCard({ subject: subjectId, kind: "lesson", date: today() });
  const entry = openCardDoc(id);
  seedLesson(entry);
  closeCardDoc(id);
  return id;
}

export function createTest(subjectId, name, testKind) {
  const group = uid();
  const date = today();
  const cls = CLASS;
  const ids = [];
  index.transact(() => {
    for (const owner of NAMES) {
      const prof = users.get(owner) || {};
      const id = createCard({ subject: subjectId, kind: "test", testKind, name, owner, group, date, title: name });
      ids.push({ id, owner, fullName: prof.fullName || owner });
    }
  });
  for (const it of ids) {
    const entry = openCardDoc(it.id);
    seedTest(entry, { owner: it.owner, fullName: it.fullName, cls, date: fmtDate(date), name, kind: testKind });
    closeCardDoc(it.id);
  }
  return ids[0].id;
}

export function hours() { return settings.get("hours") || DEFAULT_HOURS; }
export function nowLesson() {
  const d = new Date();
  const day = d.getDay();
  if (day < 1 || day > 5) return null;
  const mins = d.getHours() * 60 + d.getMinutes();
  const hs = hours();
  for (let i = 0; i < hs.length; i++) {
    const [h, m] = hs[i].split(":").map(Number);
    const start = h * 60 + m;
    const next = i + 1 < hs.length ? (() => { const [nh, nm] = hs[i + 1].split(":").map(Number); return nh * 60 + nm; })() : start + 55;
    if (mins >= start - 10 && mins < next - 5) {
      const sid = plan.get(`${day}-${i}`);
      return { day, slot: i, subject: sid ? subject(sid) : null, time: hs[i] };
    }
  }
  return null;
}
