/* Desktop app extras: first-run move of all notes from Pupka online, the one-way "Pobierz nowości" pull, picture caching for offline use, settings rows. */

import { Y, WebsocketProvider } from "../lib/vendor.js";
import { ONLINE_WS, native, mediaName, storeState } from "./desktop.js";
import { index, INDEX_ROOM, cards, users, openCardDoc, closeCardDoc, state, PALETTE } from "./store.js";
import { aiMode, setAiMode, LOCAL_LABEL } from "./localai.js";
import { esc } from "./md.js";

const ME = "Jurek";
const SEEN = "pupka-pulled";
const STARTED = "pupka-desk-started";

function fetchRemote(room, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const tmp = new Y.Doc();
    const p = new WebsocketProvider(ONLINE_WS, room, tmp, { connect: false, maxBackoffTime: 2500 });
    p.awareness.setLocalState(null);
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const update = ok ? Y.encodeStateAsUpdate(tmp) : null;
      p.destroy();
      tmp.destroy();
      if (ok) resolve(update);
      else reject(new Error(navigator.onLine === false ? "Nie ma internetu." : "Pupka online nie odpowiada."));
    };
    const timer = setTimeout(() => done(false), timeout);
    p.on("sync", (synced) => { if (synced) done(true); });
    p.connect();
  });
}

function collectMedia(doc, names) {
  const add = (url) => { const n = mediaName(url); if (n && !n.startsWith("local/")) names.add(n); };
  const walk = (node) => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === "image") add(node.getAttribute("src"));
    node.toArray().forEach(walk);
  };
  doc.getXmlFragment("prosemirror").toArray().forEach(walk);
  doc.getArray("chat").toArray().forEach((m) => (m.attachments || []).concat(m.images || []).forEach((a) => add(a && a.url)));
}

function readSeen() { try { return JSON.parse(localStorage.getItem(SEEN) || "{}"); } catch (e) { return {}; } }

async function pullCard(id, names) {
  const e = openCardDoc(id);
  try {
    await e.idb.whenSynced;
    if (storeState.error) throw new Error(storeState.error);
    Y.applyUpdate(e.doc, await fetchRemote("card:" + id), "pull");
    collectMedia(e.doc, names);
    await e.idb.flush();
  } finally {
    closeCardDoc(id);
  }
}

let pulling = null;
export function pullOnline(onProgress = () => {}, full = false) {
  if (pulling) return pulling;
  pulling = (async () => {
    onProgress({ stage: "index" });
    Y.applyUpdate(index, await fetchRemote(INDEX_ROOM), "pull");
    await state.indexStore.flush();
    const seen = readSeen();
    const have = new Set(await native("store.ids"));
    const names = new Set();
    const add = (url) => { const n = mediaName(url); if (n && !n.startsWith("local/")) names.add(n); };
    users.forEach((u) => { add(u.avatar); add(u.signature); });
    const todo = [];
    cards.forEach((c, id) => {
      if (c.deleted) return;
      add(c.img);
      const stamp = String(c.updated || c.created || 0);
      if (full || !have.has(id) || seen[id] !== stamp) todo.push([id, stamp]);
    });
    const total = todo.length;
    let done = 0, failed = 0;
    onProgress({ stage: "cards", done, total });
    const worker = async () => {
      while (todo.length) {
        const [id, stamp] = todo.shift();
        try { await pullCard(id, names); seen[id] = stamp; } catch (e) { failed++; console.error("karta", id, e); }
        done++;
        onProgress({ stage: "cards", done, total });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (e) { /* storage blocked */ }
    onProgress({ stage: "media", total: names.size });
    const pics = await native("media.ensure", { names: Array.from(names) }).catch(() => ({ fetched: 0, failed: names.size }));
    return { cards: total - failed, failed, pictures: pics.fetched || 0, missing: pics.failed || 0 };
  })();
  pulling.then(() => { pulling = null; }, () => { pulling = null; });
  return pulling;
}

function ensureMe() {
  const p = users.get(ME);
  if (!p || !p.color) users.set(ME, Object.assign({ color: PALETTE[0] }, p || {}));
}

function progressText(p) {
  if (p.stage === "index") return "Czytam spis przedmiotów i kartek…";
  if (p.stage === "cards") return p.total ? `Kartki: ${p.done} z ${p.total}` : "Sprawdzam kartki…";
  return p.total ? `Pobieram obrazki (${p.total})…` : "Kończę…";
}

function summary(r) {
  const parts = [];
  if (r.cards) parts.push(r.cards === 1 ? "1 kartka" : `${r.cards} kartek`);
  if (r.pictures) parts.push(r.pictures === 1 ? "1 obrazek" : `${r.pictures} obrazków`);
  let text = parts.length ? `Pobrano: ${parts.join(", ")}.` : "Wszystko aktualne.";
  if (r.failed) text += ` Nie udało się pobrać ${r.failed} kartek, spróbuj jeszcze raz.`;
  if (r.missing) text += ` Brakuje ${r.missing} obrazków.`;
  return text;
}

function welcome(root) {
  return new Promise((resolve) => {
    root.innerHTML = `<main class="desk-welcome"><div class="desk-card">
      <div class="eyebrow">Pupka na Macu</div>
      <h1>Przenieść notatki z Pupki online?</h1>
      <p>Wszystkie przedmioty, kartki, rysunki i obrazki trafią do folderu <b>Dokumenty / Szkoła / Pupka</b>. Potem piszesz bez internetu, a nowe kartki chłopaków dociągasz przyciskiem „Pobierz nowości”. Pupka online zostaje bez zmian.</p>
      <div class="desk-bar" hidden><i></i></div>
      <div class="desk-status" aria-live="polite"></div>
      <div class="desk-actions"><button class="btn primary big" data-go="move">Przenieś notatki</button><button class="btn big" data-go="empty">Zacznij od pustego zeszytu</button></div>
    </div></main>`;
    const bar = root.querySelector(".desk-bar"), fill = bar.firstElementChild, status = root.querySelector(".desk-status"), actions = root.querySelector(".desk-actions");
    root.querySelector('[data-go="empty"]').addEventListener("click", () => resolve());
    root.querySelector('[data-go="move"]').addEventListener("click", async () => {
      actions.hidden = true;
      bar.hidden = false;
      status.classList.remove("bad");
      try {
        const r = await pullOnline((p) => {
          status.textContent = progressText(p);
          fill.style.width = (p.stage === "index" ? 4 : p.stage === "cards" ? 6 + 78 * (p.total ? p.done / p.total : 1) : 92) + "%";
        }, true);
        fill.style.width = "100%";
        status.textContent = summary(r);
        setTimeout(resolve, 1300);
      } catch (e) {
        bar.hidden = true;
        actions.hidden = false;
        status.classList.add("bad");
        status.textContent = `${e.message || "Nie udało się."} Spróbuj jeszcze raz, gdy będzie internet.`;
      }
    });
  });
}

let toastEl = null, toastTimer = 0;
function toast(text, sticky) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "desk-toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => toastEl.classList.remove("on"), 5200);
}

export async function pullWithToast(full) {
  if (pulling) return;
  try {
    const r = await pullOnline((p) => toast(progressText(p), true), !!full);
    toast(summary(r));
  } catch (e) {
    toast(e.message || "Nie udało się pobrać nowości.");
  }
}

export async function desktopBoot(root) {
  if (storeState.error) {
    root.innerHTML = `<main class="desk-welcome"><div class="desk-card"><div class="eyebrow">Pupka na Macu</div><h1>Nie mogę otworzyć notatek</h1><p>${esc(storeState.error)}</p><p>Sprawdź folder Dokumenty / Szkoła / Pupka i uruchom Pupkę ponownie. Nic nie zostało nadpisane.</p></div></main>`;
    return false;
  }
  let started = false;
  try { started = !!localStorage.getItem(STARTED); } catch (e) { /* storage blocked */ }
  if (!started && cards.size === 0) await welcome(root);
  try { localStorage.setItem(STARTED, "1"); } catch (e) { /* storage blocked */ }
  ensureMe();
  window.pupkaPull = () => pullWithToast(false);
  return ME;
}

export function desktopSettingsHtml() {
  return `<section class="desk-settings"><div class="eyebrow">Pupka na Macu</div>
    <p class="muted hint">Notatki leżą w plikach w folderze Dokumenty / Szkoła / Pupka, obrazki w podfolderze Obrazki. Działa bez internetu.</p>
    <div class="desk-row"><button class="btn" data-desk="reveal">Pokaż folder w Finderze</button><button class="btn" data-desk="pull">Pobierz nowości z Pupki online</button><button class="btn" data-desk="full">Pobierz wszystko od nowa</button></div>
    <label>Asystent AI<select data-desk-mode><option value="claude" ${aiMode() === "claude" ? "selected" : ""}>Claude przez internet, lokalny model bez internetu</option><option value="local" ${aiMode() === "local" ? "selected" : ""}>Zawsze model lokalny (${LOCAL_LABEL})</option></select></label>
    <label>Model lokalny: ile wątków procesora<select data-desk-threads><option value="2">2: najciszej i najchłodniej</option><option value="3">3</option><option value="4">4: szybciej, Mac będzie cieplejszy</option></select></label>
    <div class="muted hint" data-desk-model></div>
  </section>`;
}

export function bindDesktopSettings(root) {
  const box = root.querySelector(".desk-settings");
  if (!box) return;
  const threads = box.querySelector("[data-desk-threads]"), info = box.querySelector("[data-desk-model]");
  native("model.status").then((s) => {
    threads.value = String(Math.min(4, Math.max(2, s.threads)));
    info.textContent = s.hasModel ? `${s.label} jest na tym Macu${s.running ? " i teraz działa" : ", uruchamia się przy pierwszym pytaniu i zasypia po 5 minutach ciszy"}.` : `Pliku modelu ${s.label} jeszcze nie ma na tym Macu.`;
  }).catch(() => {});
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-desk]");
    if (!b) return;
    if (b.dataset.desk === "reveal") native("app.reveal");
    else pullWithToast(b.dataset.desk === "full");
  });
  box.querySelector("[data-desk-mode]").addEventListener("change", (ev) => setAiMode(ev.target.value));
  threads.addEventListener("change", () => native("model.threads", { n: +threads.value }));
}
