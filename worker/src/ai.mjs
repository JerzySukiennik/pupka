/* AI endpoints: streaming chat with tools (read_card, search_images, edit_card) and one-shot rewrite.
   Haiku 5.5 only. The Anthropic key is a Worker secret. */

import { SYSTEM_CHAT, SYSTEM_REWRITE, TOOLS } from "./prompts.mjs";

const MODEL = "claude-haiku-5-5";
const PRICE = [1, 5];
const MAX_IMG = 1_800_000;

function usdOf(u) {
  return ((u.input_tokens || 0) * PRICE[0] + (u.output_tokens || 0) * PRICE[1] + (u.cache_read_input_tokens || 0) * PRICE[0] * 0.1 + (u.cache_creation_input_tokens || 0) * PRICE[0] * 1.25) / 1e6;
}

function day() { return new Date().toISOString().slice(0, 10); }
export async function spent(env) { return parseFloat((await env.LIMITS.get("usd:" + day())) || "0"); }
async function addSpent(env, usd) { const s = await spent(env); await env.LIMITS.put("usd:" + day(), String(s + usd), { expirationTtl: 172800 }); }

async function anthropicStream(env, body, onEvent) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(Object.assign({ stream: true }, body))
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || "Anthropic error " + r.status);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const blocks = [];
  let usage = {};
  let stop = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      if (ev.type === "message_start") usage = Object.assign({}, ev.message.usage);
      else if (ev.type === "content_block_start") {
        const b = ev.content_block;
        blocks[ev.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, json: "" } : { type: b.type, text: "" };
      } else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index];
        if (!b) continue;
        if (ev.delta.type === "text_delta") { b.text += ev.delta.text; onEvent({ t: "delta", text: ev.delta.text }); }
        else if (ev.delta.type === "input_json_delta") b.json += ev.delta.partial_json;
      } else if (ev.type === "message_delta") {
        stop = ev.delta.stop_reason;
        Object.assign(usage, ev.usage || {});
      }
    }
  }
  const content = blocks.filter(Boolean).map((b) => {
    if (b.type === "tool_use") { let input = {}; try { input = JSON.parse(b.json || "{}"); } catch (e) { input = {}; } return { type: "tool_use", id: b.id, name: b.name, input }; }
    return { type: "text", text: b.text };
  }).filter((b) => b.type !== "text" || b.text);
  return { content, usage, stop };
}

const UA = { "user-agent": "Pupka/1.0 (school notebook; gzowotesla@gmail.com)" };

async function wikiPages(lang, params) {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.search = new URLSearchParams(Object.assign({ action: "query", prop: "pageimages|info", piprop: "thumbnail|name", pithumbsize: "1400", inprop: "url", redirects: "1", format: "json", origin: "*" }, params)).toString();
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(6000) });
  const j = await r.json().catch(() => ({}));
  return Object.values((j.query && j.query.pages) || {}).filter((p) => p.thumbnail && !p.missing).sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ url: p.thumbnail.source, title: p.title, width: p.thumbnail.width, height: p.thumbnail.height, page: p.fullurl }));
}

async function searchImages(env, rawQuery, origin) {
  const raw = String(rawQuery || "");
  const cleaned = raw.replace(/\b(logo|obrazek|obrazki|zdjecie|zdjęcie|ilustracja|grafika|image|picture|photo|diagram)\b/gi, " ").replace(/\s+/g, " ").trim();
  const query = cleaned || raw;
  const items = [];
  const seen = new Set();
  const push = (it) => { if (it && it.url && !seen.has(it.url)) { seen.add(it.url); items.push(it); } };
  for (const lang of ["pl", "en"]) { try { (await wikiPages(lang, { titles: query })).forEach(push); } catch (e) { /* next */ } }
  for (const lang of ["pl", "en"]) {
    if (items.length >= 4) break;
    try { (await wikiPages(lang, { generator: "search", gsrsearch: query, gsrlimit: "3" })).slice(0, 2).forEach(push); } catch (e) { /* next */ }
  }
  if (items.length < 4) {
    try {
      const u = new URL("https://commons.wikimedia.org/w/api.php");
      u.search = new URLSearchParams({ action: "query", generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: "8", prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "1400", format: "json", origin: "*" }).toString();
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(6000) });
      const j = await r.json().catch(() => ({}));
      for (const p of Object.values((j.query && j.query.pages) || {})) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (ii && /jpeg|png|svg|webp/.test(ii.mime) && ii.thumburl) push({ url: ii.thumburl, title: p.title.replace(/^File:/, ""), width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, page: ii.descriptionurl });
      }
    } catch (e) { /* no commons */ }
  }
  return storeImages(env, items.slice(0, 6), origin);
}

async function storeImages(env, items, origin) {
  const out = [];
  for (const it of items.slice(0, 5)) {
    try {
      const r = await fetch(it.url, { headers: { "user-agent": "Mozilla/5.0 (Pupka school notebook)" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "").split(";")[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_IMG || buf.byteLength < 2000) continue;
      const ext = ct.split("/")[1].replace("jpeg", "jpg");
      const key = `ai/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const put = await env.MEDIA.get(env.MEDIA.idFromName("media")).fetch("https://media/" + key, { method: "PUT", headers: { "content-type": ct }, body: buf });
      if (!put.ok) continue;
      out.push({ url: `${origin}/media/${key}`, title: it.title, width: it.width, height: it.height, source: it.page || it.url });
      if (out.length >= 3) break;
    } catch (e) { /* skip broken image */ }
  }
  return out;
}

export async function chat(req, env, origin, sse) {
  const p = await req.json();
  const history = (p.messages || []).slice(-16).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 8000) }));
  if (!history.length || history[history.length - 1].role !== "user") throw new Error("empty question");
  const context = [
    `AKTUALNA KARTA: przedmiot "${p.subject || "?"}", karta "${p.title || "(bez tematu)"}", data ${p.date || "?"}. Pyta: ${p.person || "?"}.`,
    `TREŚĆ KARTY (ponumerowane bloki):\n${String(p.blocks || "(pusta karta)").slice(0, 60000)}`,
    p.drawings ? `RYSUNKI ODRĘCZNE NA KARCIE: ${String(p.drawings).slice(0, 600)}` : "RYSUNKI ODRĘCZNE NA KARCIE: brak",
    p.cards ? `INNE KARTY (id | przedmiot | data | temat):\n${String(p.cards).slice(0, 12000)}` : "",
    p.chatNote || ""
  ].filter(Boolean).join("\n\n");
  const system = [{ type: "text", text: SYSTEM_CHAT, cache_control: { type: "ephemeral" } }, { type: "text", text: context }];
  const messages = history.map((m, i) => i === history.length - 1 ? { role: "user", content: `${p.person || "Uczeń"}: ${m.content}` } : m);
  let usd = 0;
  let edited = false;
  for (let round = 0; round < 6; round++) {
    const res = await anthropicStream(env, { model: MODEL, max_tokens: 4000, system, messages, tools: TOOLS, output_config: { effort: "medium" } }, sse);
    usd += usdOf(res.usage);
    const tools = res.content.filter((b) => b.type === "tool_use");
    if (!tools.length || res.stop !== "tool_use") break;
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const t of tools) {
      let result = "";
      try {
        if (t.name === "read_card") {
          sse({ t: "status", text: "czytam inną kartę" });
          const id = String(t.input.card_id || "").replace(/[^a-z0-9_-]/gi, "");
          const stub = env.ROOM.get(env.ROOM.idFromName("card:" + id));
          result = await (await stub.fetch("https://room/text")).text();
          result = result.slice(0, 30000) || "(pusta karta)";
        } else if (t.name === "search_images") {
          sse({ t: "status", text: "szukam obrazka: " + t.input.query });
          const items = await searchImages(env, String(t.input.query || "").slice(0, 200), origin);
          sse({ t: "images", items });
          result = items.length ? JSON.stringify(items) : "Nic nie znaleziono. Spróbuj innego zapytania lub powiedz użytkownikowi, że nie znalazłeś.";
        } else if (t.name === "delete_drawings") {
          sse({ t: "drawings", author: t.input.author ? String(t.input.author).slice(0, 20) : null });
          edited = true;
          result = "Rysunki usunięte z karty.";
        } else if (t.name === "edit_card") {
          const ops = Array.isArray(t.input.ops) ? t.input.ops.slice(0, 60) : [];
          sse({ t: "edit", ops });
          edited = true;
          result = "Zmiany wprowadzone na karcie.";
        } else result = "unknown tool";
      } catch (e) { result = "Błąd narzędzia: " + e.message; }
      results.push({ type: "tool_result", tool_use_id: t.id, content: result });
    }
    messages.push({ role: "user", content: results });
    sse({ t: "delta", text: "\n" });
  }
  await addSpent(env, usd);
  sse({ t: "done", usd: +usd.toFixed(5), edited });
}

export async function rewrite(req, env) {
  const p = await req.json();
  const text = String(p.text || "").slice(0, 12000);
  const cmd = { explain: "Wyjaśnij ten fragment prościej, w 2-4 zdaniach, tak żeby zrozumiał uczeń 8 klasy.", expand: "Rozwiń ten fragment: dodaj brakujące szczegóły, przykłady i wyjaśnienia, zachowaj styl notatki.", fix: "Popraw błędy ortograficzne, interpunkcyjne, gramatyczne i merytoryczne. Zmieniaj tylko to, co błędne.", shorten: "Skróć ten fragment do najważniejszych punktów, zachowaj sens." }[p.mode] || String(p.instruction || "").slice(0, 500);
  const content = `FRAGMENT:\n${text}\n\nPOLECENIE: ${cmd}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: SYSTEM_REWRITE, messages: [{ role: "user", content }], output_config: { effort: "low" } })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Anthropic error " + r.status);
  const out = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  await addSpent(env, usdOf(j.usage || {}));
  return { text: out };
}
