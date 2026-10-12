/* Network helpers: API base, image upload with client-side downscale, AI streaming. */

export const API = "https://pupka-api.kalakasanyt.workers.dev";
export const WS = API.replace(/^http/, "ws") + "/ws";

export function shrinkImage(file, max = 1600, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const keepPng = file.type === "image/png" && file.size < 900_000 && scale === 1;
      if (keepPng) return resolve(file);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (file.type === "image/png" || file.type === "image/gif") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve(b) : reject(new Error("canvas")), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Nie da się odczytać obrazka")); };
    img.src = url;
  });
}

export async function uploadImage(file, who, max = 1600) {
  let blob = file;
  const keepGif = file.type === "image/gif" && file.size <= 1_800_000;
  if (!keepGif && (file.size > 1_500_000 || max < 1600 || !/^image\/(jpeg|png|webp|gif)$/.test(file.type))) blob = await shrinkImage(file, max);
  if (blob.size > 1_800_000) blob = await shrinkImage(blob, 1200, 0.75);
  const r = await fetch(API + "/media", { method: "POST", headers: { "content-type": blob.type || "image/jpeg", "x-pupka-name": who || "x" }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Upload nie wyszedł");
  return j.url;
}

export function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)[1];
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function aiChat(payload, onEvent) {
  const r = await fetch(API + "/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "AI nie odpowiada (" + r.status + ")");
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      try { onEvent(JSON.parse(chunk.slice(5))); } catch (e) { /* ignore */ }
    }
  }
}

export async function aiRewrite(payload) {
  const r = await fetch(API + "/ai/rewrite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "AI nie odpowiada");
  return j.text;
}

export async function health() {
  try { return await (await fetch(API + "/health")).json(); } catch (e) { return null; }
}
