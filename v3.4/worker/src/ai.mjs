/* AI endpoints: streaming chat with tools (read_card, search_images, edit_card) and one-shot rewrite.
   Haiku 5.5 only. The Anthropic key is a Worker secret. */

import { SYSTEM_CHAT, SYSTEM_REWRITE, TOOLS } from "./prompts.mjs";

const MODEL = "claude-haiku-5-5";
const PRICES = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
const MAX_IMG = 6_000_000;

function usdOf(u, model = MODEL) {
  const pr = PRICES[model] || [4, 20];
  return ((u.input_tokens || 0) * pr[0] + (u.output_tokens || 0) * pr[1] + (u.cache_read_input_tokens || 0) * pr[0] * 0.1 + (u.cache_creation_input_tokens || 0) * pr[0] * 1.25) / 1e6;
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
    if (onEvent.closed) { try { await reader.cancel(); } catch (e) { /* gone */ } break; }
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
        if (b.type === "tool_use") onEvent({ t: "tool", name: b.name });
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

async function findText(rawQuery) {
  const query = String(rawQuery || "").slice(0, 160);
  const api = (params) => { const u = new URL("https://pl.wikisource.org/w/api.php"); u.search = new URLSearchParams(Object.assign({ format: "json", origin: "*" }, params)).toString(); return fetch(u, { headers: UA, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => ({})); };
  const found = await api({ action: "query", list: "search", srsearch: query, srlimit: "6", srnamespace: "0" });
  const hits = ((found.query && found.query.search) || []).map((h) => h.title);
  if (!hits.length) return { error: "Nie znalazłem takiego tekstu w Wikiźródłach.", tried: query };
  for (const title of hits.slice(0, 3)) {
    const ex = await api({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain", titles: title, redirects: "1" });
    const page = Object.values((ex.query && ex.query.pages) || {})[0];
    let text = page && page.extract ? String(page.extract).trim() : "";
    if (!text) {
      const parsed = await api({ action: "parse", page: title, prop: "text", redirects: "1", disablelimitreport: "1" });
      const html = parsed.parse && parsed.parse.text && parsed.parse.text["*"];
      if (html) text = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|dd|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (text && text.length > 40) return { title, url: "https://pl.wikisource.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")), text: text.slice(0, 14000), truncated: text.length > 14000, other_results: hits.filter((h) => h !== title).slice(0, 5) };
  }
  return { error: "Znalazłem strony, ale bez czytelnego tekstu.", results: hits };
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

const DIAGRAM_BAD = /(FGM|mutilat|cutting|surg|pierc|cancer|disease|infect|herpes|HPV|STD|STI|porn|erotic|sexual (position|intercourse)|kama|fetish|torture|circumcis|abort|syphil|vasectom|snail|bufon)/i;
const DIAGRAM_OK = /(anatom|diagram|organ|genital|vulva|clitor|penis|labeled|illustration|schemat|reproductive|sexual organs)/i;

export async function diagramCandidates(rawQuery) {
  const male = /(męsk|penis|prąci|moszn|scrotum|testic|jąder|male )/i.test(String(rawQuery || ""));
  const qs = male
    ? ["male external genital organs anatomy diagram", "penis anatomy labeled diagram", "male reproductive system diagram"]
    : ["external female genital organs anatomy diagram", "vulva anatomy labeled diagram", "female external genitalia illustration", "female reproductive system diagram"];
  const items = [], seen = new Set();
  for (const q of qs) {
    try {
      const u = new URL("https://commons.wikimedia.org/w/api.php");
      u.search = new URLSearchParams({ action: "query", generator: "search", gsrsearch: q + " filetype:drawing", gsrnamespace: "6", gsrlimit: "8", prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "1200", format: "json", origin: "*" }).toString();
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(6000) });
      const j = await r.json().catch(() => ({}));
      for (const p of Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0))) {
        const ii = p.imageinfo && p.imageinfo[0];
        const title = p.title.replace(/^File:/, "");
        if (!ii || !ii.thumburl || !/svg|png/.test(ii.mime) || DIAGRAM_BAD.test(title) || !DIAGRAM_OK.test(title) || seen.has(ii.thumburl)) continue;
        seen.add(ii.thumburl);
        items.push({ url: ii.thumburl, title, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, page: ii.descriptionurl });
      }
    } catch (e) { /* next query */ }
    if (items.length >= 5) break;
  }
  return items;
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

export const INTIMATE = /(?<![\p{L}])(srom\p{L}*|pochw(a|y|ę|ie|ą|om|ach|ami)|łechtacz\p{L}*|penis\p{L}*|prąci\p{L}*|moszn\p{L}*|narząd\p{L}* (płciow|rozrodcz|intymn)\p{L}*|genital\p{L}*|vulva\p{L}*|vagina\p{L}*|labia|clitor\p{L}*|scrotum|testic\p{L}*|pubic)(?![\p{L}])/iu;

async function imageBytes(env, url) {
  const m = /\/media\/(.+)$/.exec(String(url || ""));
  let r;
  if (m) r = await env.MEDIA.get(env.MEDIA.idFromName("media")).fetch("https://media/" + m[1]);
  else if (/^https?:\/\//i.test(String(url || ""))) r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Pupka school notebook)" }, signal: AbortSignal.timeout(8000) });
  if (!r || !r.ok) return null;
  const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > 4_500_000) return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { media_type: ct, data: btoa(bin) };
}

export async function chat(req, env, origin, sse) {
  const p = await req.json();
  const history = (p.messages || []).slice(-16).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 8000) }));
  if (!history.length || history[history.length - 1].role !== "user") throw new Error("empty question");
  const context = [
    `AKTUALNA KARTA: przedmiot "${p.subject || "?"}", karta "${p.title || "(bez tematu)"}", data ${p.date || "?"}. Pyta: ${p.person || "?"}.`,
    `TREŚĆ KARTY (ponumerowane bloki):\n${String(p.blocks || "(pusta karta)").slice(0, 60000)}`,
    p.drawings ? `RYSUNKI ODRĘCZNE NA KARCIE: ${String(p.drawings).slice(0, 600)}` : "RYSUNKI ODRĘCZNE NA KARCIE: brak",
    Array.isArray(p.images) && p.images.length ? `OBRAZKI NA KARCIE (można je obejrzeć view_image i rysować/kolorować na nich): ${p.images.slice(0, 20).map((i) => "[" + (i.block | 0) + "]" + (i.alt ? " " + String(i.alt).slice(0, 60) : "")).join(", ")}` : "",
    p.imageDrawings ? `RYSUNKI NA OBRAZKACH (skala 0-1000):\n${String(p.imageDrawings).slice(0, 4000)}` : "",
    p.cards ? `INNE KARTY (id | przedmiot | data | temat):\n${String(p.cards).slice(0, 12000)}` : "",
    p.chatNote || ""
  ].filter(Boolean).join("\n\n");
  const system = [{ type: "text", text: SYSTEM_CHAT, cache_control: { type: "ephemeral" } }, { type: "text", text: context }];
  const messages = history.map((m, i) => i === history.length - 1 ? { role: "user", content: `${p.person || "Uczeń"}: ${m.content}` } : m);
  const att = Array.isArray(p.attachments) ? p.attachments.slice(0, 4) : [];
  if (att.length) {
    const blocks = [{ type: "text", text: messages[messages.length - 1].content }];
    for (const a of att) {
      const m = /\/media\/(.+)$/.exec(String(a.url || ""));
      if (!m) continue;
      const r = await env.MEDIA.get(env.MEDIA.idFromName("media")).fetch("https://media/" + m[1]);
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength > 4_500_000) continue;
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const nums = Array.isArray(a.blocks) ? a.blocks.filter((n) => Number.isInteger(n)).slice(0, 40) : [];
      blocks.push({ type: "text", text: a.kind === "point" ? `Użytkownik obrysował ten fragment kartki${nums.length ? " (bloki " + nums.map((n) => "[" + n + "]").join(", ") + ")" : ""}. Obrys jest fioletową przerywaną linią, reszta jest przyciemniona.` : "Użytkownik dołączył ten obraz." });
      blocks.push({ type: "image", source: { type: "base64", media_type: ct, data: btoa(bin) } });
    }
    messages[messages.length - 1] = { role: "user", content: blocks };
  }
  let usd = 0;
  let edited = false;
  for (let round = 0; round < 6; round++) {
    if (sse.closed) break;
    const model = p.visual && env.VISION_MODEL ? env.VISION_MODEL : MODEL;
    const res = await anthropicStream(env, { model, max_tokens: 12000, system, messages, tools: TOOLS, output_config: { effort: p.visual ? "high" : "medium" } }, sse);
    usd += usdOf(res.usage, model);
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
        } else if (t.name === "search_images" && INTIMATE.test(String(t.input.query || ""))) {
          sse({ t: "status", text: "szukam diagramu anatomicznego" });
          const items = await storeImages(env, await diagramCandidates(String(t.input.query || "")), origin);
          sse({ t: "images", items });
          result = items.length ? JSON.stringify(items) + "\nTo są wyłącznie rysunki i diagramy anatomiczne (bez zdjęć). Wybierz najlepiej opisany i wstaw przez edit_card." : "Nie ma gotowego diagramu. Narysuj opisany schemat narzędziem draw_on_card, jak w podręczniku (zdjęć tych okolic nie wstawiasz).";
        } else if (t.name === "search_images") {
          sse({ t: "status", text: "szukam obrazka: " + t.input.query });
          const items = await searchImages(env, String(t.input.query || "").slice(0, 200), origin);
          sse({ t: "images", items });
          result = items.length ? JSON.stringify(items) : "Nic nie znaleziono. Spróbuj innego zapytania lub powiedz użytkownikowi, że nie znalazłeś.";
        } else if (t.name === "find_text") {
          sse({ t: "status", text: "szukam tekstu: " + String(t.input.query || "").slice(0, 60) });
          result = JSON.stringify(await findText(t.input.query));
        } else if (t.name === "view_image") {
          const n = t.input.block | 0;
          const im = (Array.isArray(p.images) ? p.images : []).find((i) => (i.block | 0) === n);
          if (!im) result = "W bloku [" + n + "] nie ma obrazka. Obrazki są w blokach: " + (p.images || []).map((i) => "[" + i.block + "]").join(", ");
          else {
            sse({ t: "status", text: "oglądam obrazek" });
            const img = await imageBytes(env, im.grid_url || im.url);
            result = img ? [
              { type: "text", text: "Obrazek z bloku [" + n + "]" + (im.grid_url ? " z siatką: liczby na brzegach to współrzędne 0-1000 (x w prawo, y w dół). Widać rysunki, które były na obrazku w chwili wysłania wiadomości; twoje zmiany z tej odpowiedzi (usunięcia, wypełnienia, strzałki) nie są na nim widoczne, ale zostały wykonane, więc nie pisz, że coś dalej widać." : ". Współrzędne: x 0-1000 od lewej, y 0-1000 od góry.") },
              { type: "image", source: Object.assign({ type: "base64" }, img) }
            ] : "Nie udało się pobrać tego obrazka.";
          }
        } else if (t.name === "draw_on_image") {
          const shapes = Array.isArray(t.input.shapes) ? t.input.shapes.slice(0, 200) : [];
          sse({ t: "image_draw", block: t.input.block | 0, shapes });
          edited = true;
          result = shapes.length ? `Narysowano ${shapes.length} figur na obrazku.` : "Brak figur.";
        } else if (t.name === "fill_on_image") {
          const fills = Array.isArray(t.input.fills) ? t.input.fills.slice(0, 24) : [];
          sse({ t: "image_fill", block: t.input.block | 0, fills });
          edited = true;
          result = fills.length ? `Wypełniam ${fills.length} obszarów na obrazku (dokładnie do linii).` : "Brak obszarów.";
        } else if (t.name === "draw_on_card") {
          const shapes = Array.isArray(t.input.shapes) ? t.input.shapes.slice(0, 160) : [];
          sse({ t: "draw", after_block: t.input.after_block || 0, height: t.input.height || 300, shapes });
          edited = true;
          result = shapes.length ? `Narysowano ${shapes.length} figur na karcie.` : "Brak figur do narysowania.";
        } else if (t.name === "delete_drawings") {
          sse({ t: "drawings", author: t.input.author ? String(t.input.author).slice(0, 20) : null, block: t.input.on_image ? t.input.on_image | 0 : 0 });
          edited = true;
          result = t.input.on_image ? "Rysunki z obrazka usunięte." : "Rysunki usunięte z karty.";
        } else if (t.name === "make_mind_map") {
          const conv = (n, d) => ({ t: String((n && n.text) || "").slice(0, 120), k: d < 3 && n && Array.isArray(n.children) ? n.children.slice(0, 10).map((c) => conv(c, d + 1)) : [] });
          const tree = { t: String(t.input.center || "").slice(0, 120), k: (Array.isArray(t.input.branches) ? t.input.branches.slice(0, 10) : []).map((b) => conv(b, 1)) };
          sse({ t: "mind", after_block: t.input.after_block || 0, tree });
          edited = true;
          result = tree.k.length ? `Mapa myśli wstawiona (${tree.k.length} gałęzi).` : "Mapa myśli bez gałęzi, dodaj gałęzie.";
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
