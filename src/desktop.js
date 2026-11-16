/* Desktop mode (Pupka for macOS): the native bridge, notes kept as files instead of IndexedDB + WebSocket, local picture addresses. Inert in the browser. */

import { Y, WebsocketProvider } from "../lib/vendor.js";

export const DESKTOP = location.protocol === "pupka:";
export const ONLINE_WS = "wss://pupka-api.kalakasanyt.workers.dev/ws";
export const ONLINE_MEDIA = "https://pupka-api.kalakasanyt.workers.dev/media/";
export const LOCAL_MEDIA = "pupka://app/media/";

export function native(op, data) {
  if (!DESKTOP) return Promise.reject(new Error("tylko w aplikacji"));
  return window.webkit.messageHandlers.pupka.postMessage(Object.assign({ op }, data || {}));
}

export function media(url) {
  return DESKTOP && typeof url === "string" && url.startsWith(ONLINE_MEDIA) ? LOCAL_MEDIA + url.slice(ONLINE_MEDIA.length) : url;
}

export function mediaName(url) {
  if (typeof url !== "string") return "";
  if (url.startsWith(ONLINE_MEDIA)) return url.slice(ONLINE_MEDIA.length);
  if (url.startsWith(LOCAL_MEDIA)) return url.slice(LOCAL_MEDIA.length);
  return "";
}

export function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function offlineProvider(room, doc) {
  const p = new WebsocketProvider("ws://127.0.0.1:9", room, doc, { connect: false });
  p.connect = () => {};
  p.synced = true;
  return p;
}

const LOAD = "file";
const open = new Set();
export const storeState = { error: "", saving: 0 };

export function filePersist(doc, read, write) {
  let timer = 0, dirty = false, loaded = false, chain = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!dirty || !loaded) return chain;
    dirty = false;
    const data = toBase64(Y.encodeStateAsUpdate(doc));
    storeState.saving++;
    chain = chain.then(() => write(data)).then(() => { storeState.error = ""; }, (e) => { dirty = true; storeState.error = String((e && e.message) || e); console.error("zapis", e); }).then(() => { storeState.saving--; });
    return chain;
  };
  const onUpdate = (update, origin) => {
    if (origin === LOAD) return;
    dirty = true;
    if (!timer) timer = setTimeout(flush, 900);
  };
  const whenSynced = read().then((data) => {
    if (data) Y.applyUpdate(doc, fromBase64(data), LOAD);
    loaded = true;
    doc.on("update", onUpdate);
  }, (e) => {
    storeState.error = String((e && e.message) || e);
    console.error("odczyt", e);
  });
  const api = {
    whenSynced,
    flush,
    touch() { onUpdate(null, null); },
    destroy() { doc.off("update", onUpdate); open.delete(api); return flush(); }
  };
  open.add(api);
  return api;
}

export function flushAll() {
  return Promise.all(Array.from(open).map((p) => p.flush()));
}

if (DESKTOP) {
  window.pupkaFlush = flushAll;
  document.documentElement.classList.add("desktop");
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
  window.addEventListener("pagehide", () => { flushAll(); });
}
