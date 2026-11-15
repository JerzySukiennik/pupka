/* Board chrome shared by the standalone app and Pupka: frame, marker tray, caption, step dots and the question field. */
import { Board } from "./engine.js";

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6l6 6-6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8.5a6.5 6.5 0 0 1-6.5 6.5c-2.6 0-4-1-5.4-3.2L3.3 14.9a1.5 1.5 0 0 1 2.5-1.6L8 15.5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h10a6 6 0 0 1 0 12h-3"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v4M17 18h4"/></svg>',
  fresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
};

const MARKERS = [
  { color: "black", name: "Czarny marker" },
  { color: "red", name: "Czerwony marker" },
  { color: "blue", name: "Niebieski marker" },
  { color: "green", name: "Zielony marker" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function mountBoard(root, opts = {}) {
  root.classList.add("bd");
  root.innerHTML = `
    <div class="bd-frame">
      <div class="bd-surface">
        <div class="bd-float">
          <button class="bd-chip" data-act="fit" title="Pokaż całą tablicę" hidden>${ICON.fit}<span>Cała tablica</span></button>
        </div>
      </div>
      <div class="bd-tray">
        <div class="bd-tools" role="toolbar" aria-label="Przybory">
          ${MARKERS.map((m) => `<button class="bd-marker" data-color="${m.color}" title="${m.name}" aria-label="${m.name}"><i></i></button>`).join("")}
          <button class="bd-marker bd-high-tool" data-tool="high" title="Zakreślacz" aria-label="Zakreślacz"><i></i></button>
          <button class="bd-eraser" data-tool="eraser" title="Gumka" aria-label="Gumka"><i></i></button>
          <span class="bd-sep"></span>
          <button class="bd-icon" data-tool="hand" title="Przesuwanie tablicy" aria-label="Przesuwanie tablicy">${ICON.hand}</button>
          <button class="bd-icon" data-act="undo" title="Cofnij (Cmd+Z)" aria-label="Cofnij">${ICON.undo}</button>
        </div>
        <button class="bd-auto" data-act="auto" title="Gdy coś zaznaczysz albo dopiszesz, tablica od razu odpowiada" aria-pressed="true">${ICON.spark}<span>Odpowiada na rysunki</span></button>
      </div>
    </div>
    <div class="bd-under">
      <div class="bd-caption" aria-live="polite"><span class="bd-stepname"></span><p></p></div>
      <div class="bd-steps">
        <button class="bd-nav" data-act="prev" title="Poprzedni krok" aria-label="Poprzedni krok">${ICON.prev}</button>
        <div class="bd-dots"></div>
        <button class="bd-nav" data-act="next" title="Następny krok" aria-label="Następny krok">${ICON.next}</button>
        <button class="bd-play" data-act="toggle"></button>
      </div>
    </div>
    <form class="bd-ask" autocomplete="off">
      <button type="button" class="bd-new" data-act="new" title="Nowa tablica" aria-label="Nowa tablica" hidden>${ICON.fresh}</button>
      <input type="text" name="q" maxlength="600" enterkeyhint="send" aria-label="Pytanie">
      <button type="submit" class="bd-send" aria-label="Zapytaj">${ICON.send}</button>
    </form>`;

  const $ = (sel) => root.querySelector(sel);
  const surface = $(".bd-surface");
  const board = new Board(surface, opts);
  const input = $(".bd-ask input");
  const caption = $(".bd-caption p");
  const stepname = $(".bd-stepname");
  const dots = $(".bd-dots");
  const playBtn = $(".bd-play");
  const sendBtn = $(".bd-send");
  let errorText = "";
  let errorTimer = 0;

  const idle = opts.idleText || "Zapytaj o cokolwiek, a wyjaśnię to na tablicy.";
  const hint = opts.hintText || "Zaznacz albo dopisz coś na tablicy, a od razu odpowiem obok.";

  function renderTools() {
    root.querySelectorAll(".bd-marker[data-color]").forEach((b) => b.classList.toggle("on", board.tool === "pen" && board.color === b.dataset.color));
    root.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", board.tool === b.dataset.tool));
    const auto = $(".bd-auto");
    auto.classList.toggle("on", board.autoReply);
    auto.setAttribute("aria-pressed", String(board.autoReply));
    $('[data-act="undo"]').disabled = !board.undoStack.length;
  }

  function renderState() {
    const has = board.hasLesson;
    const ended = board.atEnd && !board.streaming;
    const working = board.streaming || board.busy;
    root.classList.toggle("bd-empty", !has);
    root.classList.toggle("bd-working", working);
    root.classList.toggle("bd-reacting", !!board.reacting);
    playBtn.innerHTML = ended ? `${ICON.replay}<span>Od nowa</span>` : board.playing ? `${ICON.pause}<span>Pauza</span>` : `${ICON.play}<span>Dalej</span>`;
    playBtn.disabled = !board.steps.length;
    sendBtn.innerHTML = working ? ICON.stop : ICON.send;
    sendBtn.setAttribute("aria-label", working ? "Zatrzymaj" : "Zapytaj");
    $('[data-act="fit"]').hidden = !has || (board.follow && board.allVisible());
    $('[data-act="new"]').hidden = !has;
    input.placeholder = has ? "Dopytaj o coś…" : opts.placeholder || "Zapytaj o cokolwiek…";
    renderTools();
    renderCaption();
  }

  function renderSteps() {
    const total = board.steps.length;
    dots.innerHTML = board.steps.map((s) => `<button class="bd-dot${s.n === board.curStep ? " on" : ""}${s.n < board.curStep ? " done" : ""}" data-step="${s.n}" title="${esc(s.heading)}">${s.n}</button>`).join("");
    root.classList.toggle("bd-nosteps", !total);
    renderCaption();
  }

  function renderCaption() {
    const total = board.steps.length;
    const step = board.steps.find((s) => s.n === board.curStep);
    if (errorText) {
      stepname.textContent = "";
      caption.textContent = errorText;
      caption.classList.add("bd-error");
      return;
    }
    caption.classList.remove("bd-error");
    stepname.textContent = step ? `Krok ${step.n} z ${total} · ${step.heading}` : "";
    let text = board.caption;
    if (board.reacting) text = "Patrzę, co zaznaczyłeś…";
    else if (board.busy) text = "Biorę marker…";
    else if (!board.hasLesson) text = idle;
    else if (!text && board.atEnd && !board.streaming) text = hint;
    if (caption.textContent !== text) {
      caption.textContent = text;
      caption.classList.remove("in");
      void caption.offsetWidth;
      caption.classList.add("in");
    }
  }

  board.on((ev) => {
    if (ev.type === "steps") renderSteps();
    else if (ev.type === "caption") renderCaption();
    else if (ev.type === "state") renderState();
    else if (ev.type === "error") {
      errorText = ev.text;
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => {
        errorText = "";
        renderCaption();
      }, 7000);
      renderCaption();
    }
    if (opts.onEvent) opts.onEvent(ev, board);
  });

  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.dataset.color) return board.setTool("pen", b.dataset.color);
    if (b.dataset.tool) return board.setTool(board.tool === b.dataset.tool ? "pen" : b.dataset.tool);
    if (b.dataset.step) return board.goStep(+b.dataset.step);
    const act = b.dataset.act;
    if (act === "toggle") board.toggle();
    else if (act === "prev") board.showStep(Math.max(1, board.curStep - 1));
    else if (act === "next") board.curStep >= board.steps.length ? board.play() : board.goStep(board.curStep + 1);
    else if (act === "undo") board.undo();
    else if (act === "fit") board.fit(true);
    else if (act === "auto") board.setAutoReply(!board.autoReply);
    else if (act === "new") {
      if (opts.onNew) opts.onNew(board);
      board.reset();
      input.value = "";
      input.focus();
    }
  });

  $(".bd-ask").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (board.streaming || board.busy) return board.stop();
    const q = input.value.trim();
    if (!q) return input.focus();
    input.value = "";
    errorText = "";
    if (board.hasLesson) board.more(q);
    else board.ask(q);
  });

  const onKey = (ev) => {
    if (!root.isConnected) return;
    const typing = /input|textarea/i.test(ev.target.tagName) || ev.target.isContentEditable;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !typing) {
      ev.preventDefault();
      board.undo();
    }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "ArrowRight" && board.steps.length) board.curStep >= board.steps.length ? board.play() : board.goStep(board.curStep + 1);
    else if (ev.key === "ArrowLeft" && board.steps.length) board.showStep(Math.max(1, board.curStep - 1));
    else if (ev.key.toLowerCase() === "p" && board.steps.length) board.toggle();
  };
  window.addEventListener("keydown", onKey);

  board.setTool("pen", "black");
  renderSteps();
  renderState();

  return {
    board,
    input,
    ask(q, o) {
      errorText = "";
      return board.ask(q, o);
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      board.destroy();
      root.innerHTML = "";
      root.classList.remove("bd");
    },
  };
}
