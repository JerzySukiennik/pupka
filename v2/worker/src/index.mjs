/* Pupka API: Yjs rooms (Durable Objects), media in R2, AI proxy. */

import { Room } from "./room.mjs";
import { Media } from "./media.mjs";
import { chat, rewrite, spent } from "./ai.mjs";

export { Room, Media };

export function mediaStub(env) { return env.MEDIA.get(env.MEDIA.idFromName("media")); }

const ORIGINS = [/^https:\/\/([a-z0-9-]+\.)?gzowo\.fun$/, /^https:\/\/[a-z0-9-]+\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const MAX_MEDIA = 1_900_000;

function cors(req) {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIGINS.some((r) => r.test(o)) ? o : "https://pupka.gzowo.fun",
    "access-control-allow-headers": "content-type, x-pupka-name",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "vary": "origin"
  };
}
function json(req, obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ "content-type": "application/json" }, cors(req)) });
}
function roomId(s) { return String(s || "").replace(/[^a-z0-9_:-]/gi, "").slice(0, 80); }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

    if (path.startsWith("/ws/")) {
      const id = roomId(path.slice(4));
      if (!id) return new Response("bad room", { status: 400 });
      const stub = env.ROOM.get(env.ROOM.idFromName(id));
      return stub.fetch(new Request("https://room/ws", req));
    }
    if (path.startsWith("/text/") || path.startsWith("/json/") || path.startsWith("/backups/") || path.startsWith("/stats/")) {
      const [, kind, raw] = path.split("/");
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId(raw)));
      const r = await stub.fetch("https://room/" + kind);
      return new Response(r.body, { status: r.status, headers: Object.assign({ "content-type": r.headers.get("content-type") || "text/plain" }, cors(req)) });
    }

    if (path.startsWith("/media/")) {
      if (req.method !== "GET") return json(req, { error: "GET only" }, 405);
      const cache = caches.default;
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await mediaStub(env).fetch("https://media/" + path.slice(7));
      if (!r.ok) return new Response("not found", { status: 404, headers: cors(req) });
      const h = new Headers(cors(req));
      h.set("content-type", r.headers.get("content-type") || "application/octet-stream");
      h.set("cache-control", "public, max-age=31536000, immutable");
      const res = new Response(await r.arrayBuffer(), { headers: h });
      await cache.put(req, res.clone());
      return res;
    }
    if (path === "/media-stats") {
      return new Response((await mediaStub(env).fetch("https://media/_stats")).body, { headers: Object.assign({ "content-type": "application/json" }, cors(req)) });
    }
    if (path === "/media") {
      if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
      const ct = (req.headers.get("content-type") || "").split(";")[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) return json(req, { error: "only images" }, 415);
      const len = parseInt(req.headers.get("content-length") || "0", 10);
      if (len > MAX_MEDIA) return json(req, { error: "too large" }, 413);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA) return json(req, { error: "too large" }, 413);
      const ext = ct.split("/")[1].replace("jpeg", "jpg");
      const who = (req.headers.get("x-pupka-name") || "x").replace(/[^a-z]/gi, "").slice(0, 12).toLowerCase() || "x";
      const key = `u/${who}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const put = await mediaStub(env).fetch("https://media/" + key, { method: "PUT", headers: { "content-type": ct }, body: buf });
      if (!put.ok) return json(req, { error: "too large" }, 413);
      return json(req, { url: `${url.origin}/media/${key}` });
    }

    if (path === "/health") {
      return json(req, { ok: true, haveKey: !!env.ANTHROPIC_API_KEY, spent: +(await spent(env)).toFixed(4), budget: parseFloat(env.DAILY_USD || "2") });
    }

    if (path === "/ai/chat" || path === "/ai/rewrite") {
      if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
      if (!env.ANTHROPIC_API_KEY) return json(req, { error: "AI wyłączone: brak klucza na serwerze." }, 503);
      const budget = parseFloat(env.DAILY_USD || "2");
      if ((await spent(env)) >= budget) return json(req, { error: `Dzienny limit AI ($${budget}) wyczerpany. Jutro znowu działa.` }, 429);
      if (path === "/ai/rewrite") {
        try { return json(req, await rewrite(req, env)); } catch (e) { return json(req, { error: e.message }, 500); }
      }
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      const sse = (obj) => writer.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n")).catch(() => {});
      (async () => {
        try { await chat(req, env, url.origin, sse); } catch (e) { await sse({ t: "error", message: e.message }); }
        try { await writer.close(); } catch (e) { /* closed */ }
      })();
      return new Response(readable, { headers: Object.assign({ "content-type": "text/event-stream", "cache-control": "no-cache" }, cors(req)) });
    }

    return json(req, { error: "not found" }, 404);
  }
};
