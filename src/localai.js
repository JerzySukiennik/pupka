/* Local model mode of the desktop app: chat about the open card and selection rewrites through the llama.cpp server behind pupka://app/proxy/llm. No internet, no tools, text only. */

import { DESKTOP, native } from "./desktop.js";

const KEY = "pupka-ai-mode";
const LLM = "pupka://app/proxy/llm/v1/chat/completions";
const NOTE_LIMIT = 5200;

export const LOCAL_LABEL = "Gemma 4 E4B";

export function aiMode() {
  if (!DESKTOP) return "claude";
  try { return localStorage.getItem(KEY) === "local" ? "local" : "claude"; } catch (e) { return "claude"; }
}
export function setAiMode(mode) {
  try { localStorage.setItem(KEY, mode === "claude" ? "claude" : "local"); } catch (e) { /* storage blocked */ }
}
export function localMode() {
  return DESKTOP && (aiMode() === "local" || navigator.onLine === false);
}

const SYSTEM = `Jesteś korepetytorem w notatniku szkolnym Pupka. Rozmawiasz po polsku z uczniem 8 klasy i pomagasz mu z każdego przedmiotu.

Odpowiadasz na każde pytanie ucznia, z dowolnego przedmiotu. Na końcu tej wiadomości, między znacznikami <kartka> i </kartka>, jest kartka, którą uczeń ma teraz otwartą. Kartka to tylko tło, nigdy jej nie przepisujesz ani nie doklejasz do odpowiedzi:
- Gdy pytanie dotyczy kartki (wyjaśnij, streść, odpytaj, co tu jest napisane), korzystasz z niej.
- Gdy pytanie dotyczy czegoś, czego na kartce nie ma, albo zupełnie innego przedmiotu, po prostu odpowiadasz z własnej wiedzy. Nie piszesz, że tego nie ma w notatce, nie zgadujesz, czemu uczeń o to pyta, i nie pytasz, czy na pewno chce odpowiedzi. Zapytał, więc chce wiedzieć.

Jak odpowiadasz:
- Pierwsze zdanie jest już odpowiedzią. Bez wstępów typu „Oczywiście!” i bez powtarzania pytania.
- Krótko i konkretnie, zwykle 3-8 zdań albo krótka lista. Dłużej tylko wtedy, gdy uczeń o to prosi.
- Prostym, naturalnym polskim, z przykładem, gdy to pomaga zrozumieć.
- Jeśli nie jesteś pewien faktu, daty albo liczby, powiedz to wprost zamiast zgadywać.
- Formatowanie: zwykły tekst, listy z myślnikami, **pogrubienie** dla najważniejszych słów. Bez tabel, bez nagłówków i bez LaTeX-a: strzałki i znaki pisz wprost (→, ⇌, ·, ², ₂).
- Nie zmieniasz notatki sam. Gdy uczeń prosi o tekst do notatki, napisz go gotowy do wklejenia; wstawi go przyciskiem „Wstaw do notatki”.
- Nie widzisz obrazków ani rysunków z kartki, tylko tekst.`;

function noteOf(p) {
  let text = String(p.blocks || "").replace(/^\[\d+\] /gm, "").trim();
  if (text.length > NOTE_LIMIT) text = text.slice(0, NOTE_LIMIT).replace(/\s\S*$/, "") + "\n(dalsza część notatki jest ucięta)";
  const head = [p.subject ? `Przedmiot: ${p.subject}` : "", p.title ? `Temat: ${p.title}` : "", p.date ? `Data lekcji: ${p.date}` : ""].filter(Boolean).join("\n");
  return `<kartka>\n${head}\n\n${text || "(kartka jest pusta)"}\n</kartka>`;
}

function clip(text, limit) {
  const t = String(text || "").trim();
  return t.length > limit ? t.slice(0, limit).replace(/\s\S*$/, "") + " (…)" : t;
}

function conversation(p) {
  const out = [{ role: "system", content: `${SYSTEM}\n\n${noteOf(p)}` }];
  const all = (p.messages || []).filter((m) => m.content && !/^\(zatrzymane\)$/.test(m.content));
  const start = Math.max(0, Math.floor((all.length - 5) / 4) * 4);
  for (const m of all.slice(start)) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = role === "user" ? clip(String(m.content).replace(/^[^:\n]{1,14}: /, ""), 700) : clip(m.content, 500);
    const last = out[out.length - 1];
    if (last.role === role && role !== "system") last.content += "\n\n" + content;
    else out.push({ role, content });
  }
  if (out.length > 1 && out[1].role === "assistant") out.splice(1, 1);
  return out;
}

async function failure(r) {
  let msg = "Model lokalny nie odpowiada.";
  try { msg = (await r.json()).error || msg; } catch (e) { /* not json */ }
  return new Error(typeof msg === "string" ? msg : msg.message || "Model lokalny nie odpowiada.");
}

async function stream(messages, onText, signal, maxTokens) {
  const r = await fetch(LLM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, stream: true, cache_prompt: true, max_tokens: maxTokens, temperature: 0.5, top_p: 0.9, stop: ["<kartka", "</kartka"] }), signal });
  if (!r.ok) throw await failure(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices[0].delta;
        if (delta && delta.content) onText(delta.content);
      } catch (e) { /* keep reading */ }
    }
  }
}

export async function localChat(payload, onEvent, signal) {
  const status = await native("model.status").catch(() => null);
  if (status && !status.hasModel) throw new Error(`Nie ma jeszcze pliku modelu lokalnego (${LOCAL_LABEL}).`);
  onEvent({ t: "status", text: status && status.running ? "czytam notatkę" : "budzę model lokalny" });
  let first = true;
  const slow = setTimeout(() => { if (first) onEvent({ t: "wait", text: "Pierwsze pytanie przy tej kartce trwa najdłużej, kolejne idą szybciej." }); }, 9000);
  try {
    await stream(conversation(payload), (text) => {
      if (first) { first = false; text = text.replace(/^\s+/, ""); }
      if (text) onEvent({ t: "delta", text });
    }, signal, 700);
  } finally {
    clearTimeout(slow);
  }
}

let warmKey = "";
export function warmLocal(payload) {
  if (!localMode()) return;
  const messages = [{ role: "system", content: `${SYSTEM}\n\n${noteOf(payload)}` }, { role: "user", content: "." }];
  const key = messages[0].content;
  if (key === warmKey) return;
  warmKey = key;
  fetch(LLM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, stream: false, cache_prompt: true, max_tokens: 1 }) }).catch(() => { warmKey = ""; });
}

const REWRITE = {
  fix: "Popraw WYŁĄCZNIE błędy formalne: wielkie litery, kropki, przecinki i inne znaki interpunkcyjne, literówki i ortografię, spacje. NIE zmieniaj treści: zostaw każde słowo, kolejność, sformułowania, liczby, daty, nazwy i fakty, nawet jeśli wyglądają na błędne. Nie dopisuj, nie usuwaj i nie przeredagowuj zdań. Zachowaj formatowanie. Jeśli nie ma błędów formalnych, zwróć fragment bez zmian.",
  explain: "Wyjaśnij ten fragment prościej, w 2-4 zdaniach, tak żeby zrozumiał uczeń 8 klasy.",
  expand: "Rozwiń ten fragment: dodaj brakujące szczegóły, przykłady i wyjaśnienia, zachowaj styl notatki.",
  shorten: "Skróć ten fragment do najważniejszych informacji, zachowaj styl notatki."
};

export async function localRewrite(payload) {
  const text = String(payload.text || "").slice(0, 6000);
  const messages = [
    { role: "system", content: "Jesteś asystentem w notatniku szkolnym ucznia 8 klasy. Dostajesz fragment notatki i polecenie. Zwracasz WYŁĄCZNIE nowy tekst fragmentu, po polsku, bez komentarzy, bez cudzysłowów i bez wstępu. Listy zapisuj z myślnikami, ważne słowa możesz **pogrubić**." },
    { role: "user", content: `FRAGMENT:\n${text}\n\nPOLECENIE: ${REWRITE[payload.mode] || REWRITE.fix}` }
  ];
  let out = "";
  await stream(messages, (t) => { out += t; }, undefined, Math.min(1800, Math.round(text.length / 2) + 400));
  return out.trim().replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
}
