/* Tablica inside Pupka: the shared board engine in the paper theme, opened empty or with a fragment of a card, with the finished board insertable back into that card. */

import { mountBoard } from "./board/ui.js";
import { topbar } from "./ui.js";
import { me, card as getCard } from "./store.js";
import { uploadImage } from "./net.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const BOARD_API = LOCAL ? "http://127.0.0.1:8797" : "https://board-api.kalakasanyt.workers.dev";
const HANDOFF = "pupka-board";
const INSERT = "pupka-board-insert";
const STUDENT = "The student is in the 8th grade of a Polish primary school (about 14 years old). Explain at that level and in Polish.";
const GREETING = `title O co chcesz zapytać?
note Napisz pytanie na dole
note albo narysuj je tutaj piórem.
fig I 44 30
circle 15 15 10 orange
circle 11.5 12.5 1 orange fill
circle 18.5 12.5 1 orange fill
curve 9.5 16.5 12 20 15 21 18 20 20.5 16.5 orange
curve 28 8 33 6 36 10 33 14 31 17 blue
circle 31 21.5 0.7 blue fill`;

export const BOARD_ICON = '<svg class="ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>';

export function openBoard({ text = "", context = "", card = "", pos = 0 } = {}) {
  const clean = text.replace(/\s+/g, " ").trim();
  const title = clean.length > 62 ? clean.slice(0, 58).replace(/\s\S*$/, "") + "…" : clean;
  sessionStorage.setItem(HANDOFF, JSON.stringify({ q: clean ? `Wyjaśnij mi to: ${clean.slice(0, 560)}` : "", title, context, card, pos, back: location.hash || "#/" }));
  location.hash = "#/board";
}

export function takeBoardInsert(cardId) {
  let item = null;
  try {
    item = JSON.parse(sessionStorage.getItem(INSERT) || "null");
  } catch {}
  if (!item || item.card !== cardId) return null;
  sessionStorage.removeItem(INSERT);
  return item;
}

export function renderBoard(root) {
  let hand = null;
  try {
    hand = JSON.parse(sessionStorage.getItem(HANDOFF) || "null");
  } catch {}
  sessionStorage.removeItem(HANDOFF);
  hand = hand || {};
  const target = hand.card && getCard(hand.card) ? hand.card : "";
  const back = hand.back && hand.back !== "#/board" ? hand.back : "#/";

  root.innerHTML = `${topbar({ back, title: `<span class="tb-crumb">Tablica</span>`, right: target ? `<button class="btn primary board-insert" disabled>${BOARD_ICON}<span>Wstaw do notatki</span></button>` : "" })}<main class="board-page"><div class="board-host" data-theme="paper"></div></main>`;
  const insert = root.querySelector(".board-insert");

  const ui = mountBoard(root.querySelector(".board-host"), {
    api: BOARD_API,
    app: "pupka",
    context: [STUDENT, hand.context].filter(Boolean).join("\n"),
    idleText: "Zapytaj o cokolwiek, a wyjaśnię to na tablicy.",
    onEvent(ev, board) {
      if (insert && ev.type === "state") insert.disabled = !board.hasLesson || board.streaming || board.busy;
    },
  });
  const board = ui.board;

  if (insert) {
    insert.addEventListener("click", async () => {
      const cv = board.picture(1800);
      if (!cv) return;
      insert.disabled = true;
      insert.classList.add("busy");
      try {
        const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
        const src = await uploadImage(new File([blob], "tablica.png", { type: "image/png" }), me(), 1800);
        sessionStorage.setItem(INSERT, JSON.stringify({ card: target, pos: hand.pos || 0, src, alt: `Tablica: ${board.title || board.question}`.slice(0, 160) }));
        location.hash = "#/c/" + target;
      } catch (err) {
        insert.disabled = false;
        insert.classList.remove("busy");
        board.emit("error", { text: err.message || "Nie udało się wstawić tablicy." });
      }
    });
  }

  let alive = true;
  board.ready().then(() => {
    if (!alive) return;
    if (hand.q) ui.ask(hand.q, { title: hand.title });
    else board.greet(GREETING);
  });

  return {
    board: true,
    destroy() {
      alive = false;
      ui.destroy();
    },
  };
}
