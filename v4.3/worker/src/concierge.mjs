/* Concierge API: token-protected edits of cards and the index for Jurek's personal assistant. Reading stays on the public /text and /json routes. */

function roomStub(env, id) { return env.ROOM.get(env.ROOM.idFromName(id)); }
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const post = (stub, path, body) => stub.fetch("https://room/" + path, { method: "POST", body: JSON.stringify(body) });
const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const CARD = /^[a-z0-9]{6,40}$/;

export async function concierge(req, env, action) {
  if (!env.CONCIERGE_TOKEN) return out({ error: "Concierge API wyłączone" }, 503);
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!same(given, env.CONCIERGE_TOKEN)) return out({ error: "unauthorized" }, 401);
  if (action === "ping") return out({ ok: true });
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  let body; try { body = await req.json(); } catch (e) { return out({ error: "bad json" }, 400); }
  const index = roomStub(env, body.index || "index-e2");
  if (action === "card_edit") {
    if (!CARD.test(body.card || "")) return out({ error: "zła karta" }, 400);
    const r = await post(roomStub(env, "card:" + body.card), "edit", { ops: body.ops });
    if (r.ok) await post(index, "index_edit", { op: "touch_card", card: body.card });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }
  if (action === "card_create") {
    const made = await post(index, "index_edit", { op: "create_card", subject: body.subject, date: body.date, title: body.title });
    const j = await made.json();
    if (!made.ok) return out(j, made.status);
    const blocks = [{ type: "paragraph", text: "Temat: " + (body.title || "") }].concat(body.blocks || []);
    const r = await post(roomStub(env, "card:" + j.id), "edit", { ops: [{ op: "append", blocks, after: 0 }] });
    return new Response(JSON.stringify(Object.assign({ id: j.id }, await r.json())), { status: r.status, headers: { "content-type": "application/json" } });
  }
  if (action === "card_trash") {
    if (!CARD.test(body.card || "")) return out({ error: "zła karta" }, 400);
    const r = await post(index, "index_edit", { op: "trash_card", card: body.card });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }
  return out({ error: "nieznana akcja" }, 404);
}
