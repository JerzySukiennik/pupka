/* Screens outside the editor: person picker, home, subject, plan, trash, settings, search. */

import { NAMES, PALETTE, FONTS, DAYS, DEFAULT_HOURS, users, settings, plan, listSubjects, rankedSubjects, listCards, allCards, subject, card, createSubject, updateSubject, reorderSubjects, createLesson, createTest, updateCard, trashCard, trashSubject, restoreCard, restoreSubject, trashItems, presence, setMe, me, myProfile, nowLesson, hours, today, fmtDate, fmtDateLong, updatePresence, state, onChange } from "./store.js";
import { uploadImage, dataUrlToBlob } from "./net.js";
import { topbar, avatarHtml, presenceHtml } from "./ui.js";
import { icon } from "./icons.js";
import { esc } from "./md.js";
import { userWords, removeUserWord, spellStatus, loadSpeller, reloadSpeller } from "./spell.js";
import { SLOTS, DAY_NAMES, WEEK, lessonsOn, lessonNow, sameOptions, groupOf } from "./timetable.js";
import { from as morphFrom, vt, NAMES as VT } from "./morph.js";

const WEEKDAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
function go(hash) { location.hash = hash; }
function plural(n, a, b, c) { if (n === 1) return a; const m = n % 10, h = n % 100; return m >= 2 && m <= 4 && !(h >= 12 && h <= 14) ? b : c; }

export function renderPicker(root, onPicked) {
  const el = document.createElement("div");
  el.className = "picker";
  const d = new Date(), h = d.getHours();
  const greet = h < 5 ? "Późno już" : h < 11 ? "Dzień dobry" : h < 18 ? "Cześć" : "Dobry wieczór";
  const now = lessonNow(new Date(), groupOf(null));
  const tilt = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const colorOfTile = (n) => (users.get(n) || {}).color || PALETTE[NAMES.indexOf(n)];
  const onlineNames = () => new Set(presence().map((s) => s.user && s.user.name).filter(Boolean));
  function tileHtml(n, i) {
    const p = users.get(n) || {};
    return `<button class="tile ${p.color ? "" : "fresh"}" data-name="${n}" style="--c:${colorOfTile(n)};--i:${i};--r:${[-3, 0, 3][i] || 0}deg"><span class="tile-card"><span class="tile-top"><kbd>${i + 1}</kbd><span class="tile-live"><i></i>jest w Pupce</span></span><span class="tile-av">${avatarHtml({ name: n, color: colorOfTile(n), avatar: p.avatar }, 92)}</span><span class="tile-name">${n}</span><span class="tile-meta">${p.color ? `Wejdź${icon("chevronRight", 14)}` : "Pierwszy raz: kolor i zdjęcie"}</span></span></button>`;
  }
  function draw() {
    el.classList.remove("setup-mode");
    el.innerHTML = `<div class="picker-box">
      <div class="pk-kicker">${esc(WEEKDAYS[d.getDay()])} · ${esc(fmtDateLong(today()))}${now ? ` · ${esc(now.choices[0].when)} ${esc(now.choices.filter((c) => c.when === now.choices[0].when).map((c) => c.label).join(" albo "))}` : ""}</div>
      <h1 class="wordmark" aria-label="Pupka">${"Pupka".split("").map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")}</h1>
      <p class="picker-sub">${greet}. Kto dziś pisze?</p>
      <div class="picker-tiles">${NAMES.map(tileHtml).join("")}</div>
      <div class="picker-foot"><span class="pk-net"></span>${tilt ? `<span>wybierz klawiszem 1, 2 albo 3</span>` : ""}</div>
      <img class="watermark picker-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs">
    </div>`;
    patch();
  }
  function patch() {
    const on = onlineNames();
    el.querySelectorAll(".tile").forEach((t) => {
      const n = t.dataset.name, p = users.get(n) || {};
      t.style.setProperty("--c", colorOfTile(n));
      t.classList.toggle("fresh", !p.color);
      t.classList.toggle("online", on.has(n));
      const av = t.querySelector(".tile-av");
      const html = avatarHtml({ name: n, color: colorOfTile(n), avatar: p.avatar }, 92);
      if (av && av.dataset.html !== html) { av.innerHTML = html; av.dataset.html = html; }
      const meta = t.querySelector(".tile-meta");
      if (meta) meta.innerHTML = p.color ? `Wejdź${icon("chevronRight", 14)}` : "Pierwszy raz: kolor i zdjęcie";
    });
    const txt = el.querySelector(".pk-net");
    if (txt) { txt.textContent = state.online ? "" : "offline, wszystko zapisze się po powrocie sieci ·"; txt.hidden = !!state.online; }
  }
  draw();
  const obs = () => { if (!el.classList.contains("setup-mode")) patch(); };
  users.observe(obs);
  const offStatus = onChange(() => obs());
  let leaving = false;
  function choose(name) {
    if (leaving) return;
    const t = el.querySelector(`.tile[data-name="${name}"]`);
    if (!t) return;
    leaving = true;
    const p = users.get(name) || {};
    t.classList.add("picked");
    el.querySelectorAll(".tile").forEach((x) => { if (x !== t) x.classList.add("away"); });
    el.classList.add(p.color ? "leaving" : "to-setup");
    if (p.color) { notebook(t.querySelector(".tile-card"), colorOfTile(name), name); return; }
    setTimeout(() => { leaving = false; setup(name); }, 420);
  }
  function notebook(src, color, name) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!src || reduce || !src.animate) { el.classList.add("gone"); setTimeout(() => finish(name), 220); return; }
    const r = src.getBoundingClientRect();
    const fly = document.createElement("div");
    fly.className = "pk-fly";
    fly.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--c:${color}`;
    document.body.appendChild(fly);
    src.style.visibility = "hidden";
    el.classList.add("leaving");
    fly.animate([
      { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", borderRadius: "22px", borderLeftWidth: "6px", backgroundColor: "#fffefb" },
      { left: "0px", top: "0px", width: innerWidth + "px", height: innerHeight + "px", borderRadius: "0px", borderLeftWidth: "0px", backgroundColor: "#f5f4ee" }
    ], { duration: 720, delay: 60, easing: "cubic-bezier(.7,0,.2,1)", fill: "forwards" });
    setTimeout(() => {
      finish(name);
      fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: "ease", fill: "forwards" }).finished.then(() => fly.remove(), () => fly.remove());
    }, 790);
  }
  el.addEventListener("click", (e) => {
    const t = e.target.closest(".tile");
    if (t && !el.classList.contains("setup-mode")) choose(t.dataset.name);
  });
  if (tilt) {
    el.addEventListener("pointermove", (e) => {
      const t = e.target.closest(".tile");
      el.querySelectorAll(".tile.tilting").forEach((x) => { if (x !== t) { x.classList.remove("tilting"); x.style.removeProperty("--rx"); x.style.removeProperty("--ry"); } });
      if (!t || leaving) return;
      const r = t.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      t.classList.add("tilting");
      t.style.setProperty("--ry", (x * 12).toFixed(2) + "deg");
      t.style.setProperty("--rx", (-y * 10).toFixed(2) + "deg");
    });
    el.addEventListener("pointerleave", () => el.querySelectorAll(".tile.tilting").forEach((x) => { x.classList.remove("tilting"); x.style.removeProperty("--rx"); x.style.removeProperty("--ry"); }));
  }
  const onKey = (e) => {
    if (el.classList.contains("setup-mode")) { if (e.key === "Escape") { e.preventDefault(); draw(); } return; }
    const i = ["1", "2", "3"].indexOf(e.key);
    if (i >= 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); choose(NAMES[i]); }
  };
  document.addEventListener("keydown", onKey);
  function finish(name) {
    users.unobserve(obs); offStatus(); document.removeEventListener("keydown", onKey);
    el.remove(); setMe(name);
    document.body.classList.add("home-enter");
    setTimeout(() => document.body.classList.remove("home-enter"), 1800);
    onPicked();
  }
  function setup(name) {
    el.classList.remove("to-setup");
    el.classList.add("setup-mode");
    const box = el.querySelector(".picker-box");
    let color = PALETTE[NAMES.indexOf(name)] || PALETTE[0];
    let avatar = null;
    box.innerHTML = `<div class="setup-card" style="--c:${color}">
        <div class="pk-kicker">pierwszy raz w Pupce</div>
        <h2 class="setup-title">Cześć, ${esc(name)}</h2>
        <p class="picker-sub">Wybierz kolor i zdjęcie. Potem wystarczy jedno kliknięcie.</p>
        <div class="avatar-pick" style="--c:${color}"><span class="av-wrap">${avatarHtml({ name, color }, 116)}<span class="av-cam">${icon("camera", 18)}</span></span><input type="file" accept="image/*,.gif" hidden><button type="button" class="btn small upload-btn">${icon("image", 14)}<span>Wgraj zdjęcie lub gif</span></button></div>
        <div class="swatches big">${PALETTE.map((c, i) => `<button data-color="${c}" style="--c:${c};--i:${i}" class="${c === color ? "on" : ""}" title="Kolor"></button>`).join("")}</div>
        <input class="fullname" placeholder="Imię i nazwisko do kartkówek" value="${esc((users.get(name) || {}).fullName || "")}">
        <div class="setup-actions"><button class="btn ghost back-btn">${icon("back", 15)}<span>Wróć</span></button><button class="btn primary big done">Gotowe${icon("chevronRight", 16)}</button></div>
      </div>`;
    const card = box.querySelector(".setup-card");
    const pick = box.querySelector(".avatar-pick");
    const file = pick.querySelector("input");
    pick.addEventListener("click", (e) => { if (e.target.closest(".av-wrap, .upload-btn")) file.click(); });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      pick.classList.add("busy");
      const label = pick.querySelector(".upload-btn span"); label.textContent = "Wgrywam…"; try { avatar = await uploadImage(f, name, 320); pick.querySelector(".avatar").innerHTML = `<img src="${avatar}" alt="">`; label.textContent = "Zmień zdjęcie lub gif"; } catch (err) { label.textContent = "Wgraj zdjęcie lub gif"; alert("Nie udało się wgrać: " + err.message); }
      pick.classList.remove("busy");
    });
    box.querySelector(".swatches").addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      color = b.dataset.color;
      box.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
      card.style.setProperty("--c", color);
      pick.style.setProperty("--c", color);
      pick.querySelector(".avatar").style.setProperty("--c", color);
    });
    box.querySelector(".back-btn").addEventListener("click", () => draw());
    const done = () => {
      const prev = users.get(name) || {};
      users.set(name, Object.assign({}, prev, { color, avatar: avatar || prev.avatar || null, fullName: box.querySelector(".fullname").value.trim() || name }));
      notebook(box.querySelector(".setup-card"), color, name);
    };
    box.querySelector(".done").addEventListener("click", done);
    box.querySelector(".fullname").addEventListener("keydown", (e) => { if (e.key === "Enter") done(); });
  }
  root.appendChild(el);
}

function homeRight() {
  const p = myProfile();
  const online = presence().map((s) => s.user);
  return `<button class="search-pill" data-go="#/search" title="Szukaj we wszystkich notatkach (Cmd+K)">${icon("search", 15)}<span>Szukaj</span><kbd>⌘K</kbd></button>${presenceHtml(online, 26)}${state.online ? "" : `<span class="offline-pill" title="Zmiany zapiszą się, gdy wróci sieć">${icon("offline", 14)}<span>offline</span></span>`}<button class="icon-btn" data-go="#/settings" title="Ustawienia">${icon("settings2")}</button><button class="me-btn" data-go="#/switch" title="Zmień osobę">${avatarHtml({ name: me(), color: p.color, avatar: p.avatar }, 30)}</button>`;
}
function navHtml(on) {
  return [["#/", "Dziś", "home"], ["#/plan", "Plan lekcji", "plan"], ["#/trash", "Kosz", "trash"]].map(([h, t, k]) => `<a href="${h}" class="${k === on ? "on" : ""}">${t}</a>`).join("");
}

function whoOn(cardId) { return presence().filter((s) => s.card === cardId).map((s) => s.user); }
function whoOnSubject(sid) { const ids = new Set(listCards(sid).map((c) => c.id)); return presence().filter((s) => s.card && ids.has(s.card)).map((s) => s.user); }
function snippet(c, n = 150) { const t = (c.text || "").replace(/^\s*temat\s*:[^\n]*\n?/i, "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t; }
function letters(text) { let i = 0; return String(text).split(" ").map((w) => `<span class="hw">${Array.from(w).map((ch) => `<span class="hl" style="--i:${i++}">${esc(ch)}</span>`).join("")}</span>`).join(" "); }
function cardLabel(c) { return c.title || c.name || snippet(c, 60) || "bez tematu"; }
function todayChips() {
  const d = new Date();
  const t = d.getHours() * 60 + d.getMinutes();
  const m = (hm) => { const [h, mm] = hm.split(":").map(Number); return h * 60 + mm; };
  const merged = [];
  for (const l of lessonsOn(d.getDay(), groupOf(me()))) { const last = merged[merged.length - 1]; if (last && sameOptions(last, l) && last.lastSlot === l.i - 1) { last.end = l.end; last.lastSlot = l.i; } else merged.push(Object.assign({}, l, { lastSlot: l.i })); }
  return merged.map((l) => Object.assign(l, { cur: t >= m(l.start) && t < m(l.end), past: t >= m(l.end) }));
}
function subjectState(sub) {
  const lessons = listCards(sub.id, "lesson");
  return { todayCard: lessons.find((c) => c.date === today()), last: lessons[0] };
}

export function renderHome(root) {
  const now = lessonNow(new Date(), groupOf(me()));
  const ranked = rankedSubjects();
  const subs = listSubjects();
  const pupkaChoices = now ? now.choices.filter((c) => c.sub) : [];
  const otherChoices = now ? now.choices.filter((c) => !c.sub) : [];
  const choiceMode = pupkaChoices.length > 1 || (pupkaChoices.length === 1 && otherChoices.length > 0);
  const heroSub = pupkaChoices.length === 1 && !choiceMode ? pupkaChoices[0].sub : ranked[0];
  const isNow = pupkaChoices.length === 1 && !choiceMode;
  const { todayCard, last } = heroSub ? subjectState(heroSub) : {};
  const inside = heroSub ? whoOnSubject(heroSub.id) : [];
  const chips = todayChips();
  const d = new Date();
  const recent = allCards().filter((c) => c.kind === "lesson" || c.owner === me()).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0)).slice(0, 6);
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const kicker = isNow ? `${cap(pupkaChoices[0].when)} · ${pupkaChoices[0].slot}. lekcja · ${pupkaChoices[0].start}-${pupkaChoices[0].end}` : now && !pupkaChoices.length ? `${cap(now.choices[0].when)} ${esc(now.choices.filter((c) => c.when === now.choices[0].when).map((c) => c.label).join(" albo "))} · ostatnio otwierane` : `${esc(WEEKDAYS[d.getDay()])} · ${esc(fmtDateLong(today()))}`;
  const lead = heroSub ? (todayCard ? `Dzisiejsza karta już jest${todayCard.title ? `: ${esc(todayCard.title)}` : ""}.` : last ? `Ostatnio: ${esc(cardLabel(last))}.` : "Jeszcze nie ma tu żadnej lekcji.") : "";
  const choiceHtml = choiceMode ? `<section class="hero choice-hero">
      <div class="kicker">Do wyboru · ${esc(WEEKDAYS[d.getDay()])}</div>
      <div class="choices">${pupkaChoices.map((c, i) => { const st = subjectState(c.sub); const who = whoOnSubject(c.sub.id); return `<button class="choice" data-pick="${c.sub.id}" style="--i:${i}"><small>${esc(c.when)} · ${c.start}-${c.end}</small><span class="choice-name">${esc(c.sub.name)}</span><span class="choice-meta">${st.todayCard ? "dzisiejsza karta już jest" : st.last ? "ostatnio: " + esc(cardLabel(st.last)) : "jeszcze pusto"}${who.length ? " " + presenceHtml(who, 18) : ""}</span><span class="choice-go">${icon("write", 15)}${st.todayCard ? "Otwórz" : "Zacznij"}</span></button>`; }).join("")}</div>
      ${otherChoices.length ? `<p class="choice-other">albo ${esc(otherChoices.map((c) => c.label).join(", "))}, poza Pupką</p>` : ""}
    </section>` : "";
  root.innerHTML = `${topbar({ title: "", right: homeRight(), nav: navHtml("home") })}
  <main class="home">
    ${choiceMode ? choiceHtml : heroSub ? `<section class="hero">
      <h1 class="hero-name">${letters(heroSub.name)}</h1>
      <div class="hero-side"><div class="kicker">${kicker}</div><p>${lead}${inside.length ? ` <span class="live-in">${presenceHtml(inside, 20)} ${esc(inside.map((u) => u.name).join(", "))} ${inside.length > 1 ? "piszą" : "pisze"} teraz</span>` : ""}</p>
        <div class="hero-go">${todayCard ? `<button class="btn primary big" data-open="${todayCard.id}">${icon("write", 16)}<span>Otwórz dzisiejszą lekcję</span></button>` : `<button class="btn primary big" data-new-lesson="${heroSub.id}">${icon("write", 16)}<span>${isNow ? "Zacznij dzisiejszą lekcję" : "Nowa lekcja"}</span></button>`}${!todayCard && last ? `<button class="btn big" data-open="${last.id}">Ostatnia lekcja</button>` : ""}<a class="btn big ghost" href="#/s/${heroSub.id}">Wszystkie</a></div></div>
    </section>` : `<section class="hero"><h1 class="hero-name">Pupka</h1><div class="hero-side"><p>Dodaj pierwszy przedmiot, a potem wpisz plan lekcji.</p><div class="hero-go"><button class="btn primary big" data-new-subject>${icon("plus", 16)}<span>Nowy przedmiot</span></button></div></div></section>`}
    <div class="plan-chips">${chips.length ? chips.map((x, ci) => `<span class="pc ${x.cur ? "cur" : x.past ? "past" : ""}" style="--i:${ci}"><b>${esc(x.start)}</b>${x.options.map((o) => (o.sub ? `<a href="#/s/${o.sub.id}">${esc(o.label)}</a>` : `<span>${esc(o.label)}</span>`)).join("<i>/</i>")}</span>`).join("") : `<a href="#/plan" class="pc quiet">${icon("calendar", 14)}<span>Dziś bez lekcji · plan tygodnia</span></a>`}</div>
    <div class="home-cols">
      <section class="toc"><h2>Przedmioty</h2>
        ${subs.map((s, ti) => { const n = listCards(s.id, "lesson").length; const who = whoOnSubject(s.id); return `<div class="toc-row" style="--i:${ti}"><a href="#/s/${s.id}" class="toc-link"><span class="toc-name"${vt(VT.title, morphFrom.subject === s.id)}>${esc(s.name)}</span><span class="toc-dots"></span>${who.length ? presenceHtml(who, 18) : ""}<span class="toc-n">${n}</span></a><button class="icon-btn toc-add" data-new-lesson="${s.id}" title="Nowa lekcja z ${esc(s.name)}">${icon("plus", 15)}</button><button class="icon-btn toc-more" data-subject-menu="${s.id}" title="Opcje">${icon("more", 15)}</button></div>`; }).join("")}
        <button class="toc-new" data-new-subject>${icon("plus", 15)}<span>Nowy przedmiot</span></button>
      </section>
      <section class="recent"><h2>Ostatnie kartki</h2>
        <div class="thumbs">${recent.length ? recent.map((c, hi) => { const s = subject(c.subject); const who = whoOn(c.id); return `<a class="thumb" href="#/c/${c.id}" style="--i:${hi};--rot:${hi % 2 ? 4 : -4}deg"><small>${esc(s ? s.name : "")}${c.kind === "test" ? " · na ocenę" : ""}</small><b>${esc(cardLabel(c))}</b><p>${esc(snippet(c))}</p>${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : ""}<span class="th-foot"><span>${esc(fmtDate(c.date))}</span>${presenceHtml(who, 18)}</span></a>`; }).join("") : `<div class="empty-list">Tu pojawią się ostatnio pisane kartki.</div>`}</div>
      </section>
    </div>
    <img class="watermark home-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs">
  </main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.open) go("#/c/" + b.dataset.open);
    else if (b.dataset.pick) { const st = subjectState(subject(b.dataset.pick)); go("#/c/" + (st.todayCard ? st.todayCard.id : createLesson(b.dataset.pick))); }
    else if (b.dataset.newLesson) go("#/c/" + createLesson(b.dataset.newLesson));
    else if (b.dataset.go) go(b.dataset.go);
    else if (b.hasAttribute("data-new-subject")) newSubjectDialog();
    else if (b.dataset.subjectMenu) subjectMenu(b, b.dataset.subjectMenu);
  });
  bindTopbar(root);
}

export function bindTopbar(root) {
  root.querySelector(".topbar")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.go === "#/search") window.dispatchEvent(new CustomEvent("pupka:search"));
    else if (b.dataset.go === "#/switch") window.dispatchEvent(new CustomEvent("pupka:switch"));
    else go(b.dataset.go);
  });
}

function dialog({ title, fields, ok, onOk }) {
  const box = document.createElement("div");
  box.className = "modal-bg";
  box.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>${fields.map((f) => `<label>${esc(f.label)}${f.type === "select" ? `<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select>` : `<input name="${f.name}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}">`}</label>`).join("")}<div class="modal-actions"><button class="btn cancel">Anuluj</button><button class="btn primary ok">${esc(ok)}</button></div></div>`;
  document.body.appendChild(box);
  const first = box.querySelector("input");
  setTimeout(() => first && first.focus(), 30);
  const close = () => box.remove();
  const submit = () => { const v = {}; box.querySelectorAll("input, select").forEach((i) => { v[i.name] = i.value.trim(); }); if (onOk(v) !== false) close(); };
  box.querySelector(".cancel").addEventListener("click", close);
  box.querySelector(".ok").addEventListener("click", submit);
  box.addEventListener("mousedown", (e) => { if (e.target === box) close(); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "SELECT") submit(); if (e.key === "Escape") close(); });
}

function newSubjectDialog() {
  dialog({ title: "Nowy przedmiot", fields: [{ name: "name", label: "Nazwa", placeholder: "np. Biologia" }, { name: "emoji", label: "Emoji (opcjonalnie)", placeholder: "🧬" }], ok: "Dodaj", onOk: (v) => { if (!v.name) return false; go("#/s/" + createSubject(v.name, v.emoji)); } });
}

function subjectMenu(anchor, sid) {
  const s = subject(sid);
  if (!s) return;
  popMenu(anchor, [
    ["Zmień nazwę", () => dialog({ title: "Nazwa przedmiotu", fields: [{ name: "name", label: "Nazwa", value: s.name }, { name: "emoji", label: "Emoji", value: s.emoji || "" }], ok: "Zapisz", onOk: (v) => { if (!v.name) return false; updateSubject(sid, { name: v.name, emoji: v.emoji }); } })],
    ["Przesuń wyżej", () => { const ids = listSubjects().map((x) => x.id); const i = ids.indexOf(sid); if (i > 0) { ids.splice(i, 1); ids.splice(i - 1, 0, sid); reorderSubjects(ids); } }],
    ["Przesuń niżej", () => { const ids = listSubjects().map((x) => x.id); const i = ids.indexOf(sid); if (i < ids.length - 1) { ids.splice(i, 1); ids.splice(i + 1, 0, sid); reorderSubjects(ids); } }],
    ["Do kosza", () => { if (confirm(`Przenieść „${s.name}” ze wszystkimi kartami do kosza?`)) { trashSubject(sid); go("#/"); } }, "danger"]
  ]);
}

let openPop = null;
export function popMenu(anchor, items) {
  if (openPop) { const same = openPop.anchor === anchor; openPop.close(); if (same) return; }
  const m = document.createElement("div");
  m.className = "pop-menu";
  m.innerHTML = items.map(([label, , cls], i) => `<button data-i="${i}" class="${cls || ""}">${esc(label)}</button>`).join("");
  document.body.appendChild(m);
  if (m.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) Array.from(m.children).forEach((c, i) => c.animate([{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 30 + i * 28, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }));
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8) + "px";
  const close = () => { m.remove(); anchor.classList.remove("menu-open"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey, true); if (openPop && openPop.m === m) openPop = null; };
  const onDoc = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey, true); }, 0);
  anchor.classList.add("menu-open");
  openPop = { anchor, m, close };
  m.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; close(); items[+b.dataset.i][1](); });
}

export function renderSubject(root, sid, tab) {
  const s = subject(sid);
  if (!s || s.deleted) { root.innerHTML = `<div class="empty">Nie ma takiego przedmiotu. <a href="#/">Wróć</a></div>`; return; }
  const lessons = listCards(sid, "lesson");
  const tests = listCards(sid, "test");
  const groups = [];
  for (const t of tests) { let g = groups.find((x) => x.group === t.group); if (!g) { g = { group: t.group, name: t.name, kind: t.testKind, date: t.date, cards: [] }; groups.push(g); } g.cards.push(t); }
  const isTests = tab === "tests";
  root.innerHTML = `${topbar({ back: "#/", title: `<span class="tb-crumb">${esc(s.emoji || "")} ${esc(s.name)}</span>`, right: homeRight() })}
  <main class="subject">
    <h1 class="page-title"><span${vt(VT.title, true)}>${esc(s.name)}</span></h1>
    <div class="subject-head">
      <nav class="tabs"><a href="#/s/${sid}" class="${isTests ? "" : "on"}">Lekcje<small>${lessons.length}</small></a><a href="#/s/${sid}?tab=tests" class="${isTests ? "on" : ""}">Na ocenę<small>${groups.length}</small></a></nav>
      ${isTests ? `<button class="btn primary" data-new-test>${icon("plus", 16)}<span>Nowy test</span></button>` : `<button class="btn primary" data-new-lesson>${icon("plus", 16)}<span>Nowa lekcja</span></button>`}
    </div>
    ${isTests ? `
      <p class="muted lead">Każdy test to trzy karty, po jednej na osobę. Cudzą kartę można tylko oglądać.</p>
      <div class="rows">${groups.length ? groups.map((g) => `<div class="row test-row"><span class="row-date">${esc(fmtDate(g.date))}</span><span class="row-main"><span class="row-title">${esc(g.name)}</span><span class="row-sub">${esc(g.kind)}</span></span><span class="test-cards">${NAMES.map((n) => { const c = g.cards.find((x) => x.owner === n); const p = users.get(n) || {}; return c ? `<a class="chip ${n === me() ? "mine" : ""}" href="#/c/${c.id}" style="--c:${p.color || "#888"}">${avatarHtml({ name: n, color: p.color, avatar: p.avatar }, 20)}<span>${n}</span>${presenceHtml(whoOn(c.id), 16)}</a>` : ""; }).join("")}</span><button class="icon-btn row-more" data-test-menu="${g.group}" title="Opcje">${icon("more")}</button></div>`).join("") : `<div class="empty-list">Jeszcze nic na ocenę. Nowy test tworzy trzy karty naraz.</div>`}</div>
    ` : `
      <div class="rows">${lessons.length ? lessons.map((c) => `<a class="row" href="#/c/${c.id}"${vt(VT.page, morphFrom.card === c.id)}><span class="row-date">${esc(fmtDate(c.date))}</span><span class="row-main"><span class="row-title"${vt(VT.ctitle, morphFrom.card === c.id)}>${esc(cardLabel(c))}</span>${snippet(c, 110) && c.title ? `<span class="row-sub">${esc(snippet(c, 110))}</span>` : ""}</span><span class="row-presence">${presenceHtml(whoOn(c.id), 20)}</span><button class="icon-btn row-more" data-card-menu="${c.id}" title="Opcje">${icon("more")}</button></a>`).join("") : `<div class="empty-list">Pusto. Pierwsza lekcja zacznie się od „Temat:”.</div>`}</div>
    `}
  </main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.hasAttribute("data-new-lesson")) go("#/c/" + createLesson(sid));
    else if (b.hasAttribute("data-new-test")) dialog({ title: "Nowy test", fields: [{ name: "kind", label: "Rodzaj", type: "select", options: [["kartkówka", "Kartkówka"], ["sprawdzian", "Sprawdzian"]] }, { name: "name", label: "Nazwa", placeholder: "np. Genetyka, dział 2" }], ok: "Utwórz 3 karty", onOk: (v) => { if (!v.name) return false; go("#/c/" + createTest(sid, v.name, v.kind)); } });
    else if (b.dataset.cardMenu) {
      const c = card(b.dataset.cardMenu);
      popMenu(b, [
        ["Zmień datę", () => dialog({ title: "Data lekcji", fields: [{ name: "date", label: "RRRR-MM-DD", value: c.date }], ok: "Zapisz", onOk: (v) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return false; updateCard(c.id, { date: v.date }); } })],
        ["Do kosza", () => trashCard(c.id), "danger"]
      ]);
    } else if (b.dataset.testMenu) {
      const g = groups.find((x) => x.group === b.dataset.testMenu);
      popMenu(b, [["Do kosza (wszystkie 3)", () => { if (confirm(`Przenieść „${g.name}” do kosza?`)) g.cards.forEach((c) => trashCard(c.id)); }, "danger"]]);
    }
  });
  bindTopbar(root);
}

export function renderPlan(root) {
  const group = groupOf(me());
  const now = lessonNow(new Date(), group);
  const today = new Date().getDay();
  const cell = (opts) => opts.map((label, k) => { const r = lessonsOn(1).concat(lessonsOn(2), lessonsOn(3), lessonsOn(4), lessonsOn(5)).flatMap((l) => l.options).find((o) => o.label === label); const other = group && opts.length === 2 && k !== group - 1 ? " other" : ""; return r && r.sub ? `<a class="${other}" href="#/s/${r.sub.id}">${esc(label)}</a>` : `<span class="${other}">${esc(label)}</span>`; }).join(" <i>/</i> ");
  root.innerHTML = `${topbar({ title: "", right: homeRight(), nav: navHtml("plan") })}
  <main class="plan"><h1 class="page-title">Plan lekcji VIII K</h1><p class="muted lead">Wbudowany w Pupkę na stałe. Kliknij przedmiot, żeby otworzyć jego lekcje. ${group ? `Grupa ${group}: przedmioty innej grupy są przekreślone (grupę zmienisz w Ustawieniach).` : "Ustaw swoją grupę w Ustawieniach, a przy podziale na grupy Pupka pokaże twój przedmiot."} W przerwie strona główna daje do wyboru lekcję, która była, i tę, która będzie.</p>
  <div class="plan-wrap"><table class="plan-grid"><thead><tr><th></th>${DAY_NAMES.map((n, i) => `<th class="${today === i + 1 ? "today" : ""}">${n}</th>`).join("")}</tr></thead><tbody>${SLOTS.map(([a, b], i) => i === 0 && [1, 2, 3, 4, 5].every((d) => !WEEK[d][0].length) ? "" : `<tr><th><b>${i}.</b><small>${a}-${b}</small></th>${[1, 2, 3, 4, 5].map((d) => { const opts = WEEK[d][i] || []; const isNow = now && now.day === d && now.slot && now.slot.i === i; return `<td class="${opts.length ? "" : "empty"} ${isNow ? "now" : ""} ${today === d ? "today" : ""}">${cell(opts)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></main>`;
  bindTopbar(root);
}

export function renderTrash(root) {
  const items = trashItems();
  root.innerHTML = `${topbar({ title: "", right: homeRight(), nav: navHtml("trash") })}
  <main class="trash"><h1 class="page-title">Kosz</h1><p class="muted lead">Rzeczy znikają na dobre po 30 dniach.</p>
  <div class="rows">${items.length ? items.map((it) => `<div class="row"><span class="row-date">${it.type === "subject" ? "przedmiot" : esc(fmtDate(it.date))}</span><span class="row-main"><span class="row-title">${esc(it.type === "subject" ? `${it.emoji || ""} ${it.name}` : (it.title || it.name || "bez tematu"))}</span>${it.type === "card" && subject(it.subject) ? `<span class="row-sub">${esc(subject(it.subject).name)}${it.owner ? " · " + esc(it.owner) : ""}</span>` : ""}</span><button class="btn small" data-restore="${it.type}:${it.id}">${icon("restore", 14)}<span>Przywróć</span></button></div>`).join("") : `<div class="empty-list">Kosz jest pusty.</div>`}</div></main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("[data-restore]");
    if (!b) return;
    const [type, id] = b.dataset.restore.split(":");
    if (type === "subject") restoreSubject(id); else restoreCard(id);
  });
  bindTopbar(root);
}

export function renderSettings(root) {
  const name = me();
  const p = myProfile();
  const hs = hours();
  root.innerHTML = `${topbar({ back: "#/", title: `<span class="tb-crumb">Ustawienia</span>`, right: homeRight() })}
  <main class="settings">
    <section><div class="eyebrow">Wspólne dla trzech</div>
      <label>Domyślna czcionka<select data-set="font">${FONTS.map((f) => `<option ${(settings.get("font") || "Newsreader") === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
    </section>
    <section><div class="eyebrow">Ja: ${esc(name)}</div>
      <label>Moja grupa (lekcje dzielone, np. matematyka / j. hiszpański)<select data-mygroup>${[[0, "Nie wiem, pokazuj obie"], [1, "Grupa 1 (pierwszy przedmiot w planie)"], [2, "Grupa 2 (drugi przedmiot w planie)"]].map(([v, t]) => `<option value="${v}" ${groupOf(name) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="profile-row"><div class="avatar-pick" style="--c:${p.color || "#555"}">${avatarHtml({ name, color: p.color, avatar: p.avatar }, 88)}<input type="file" accept="image/*,.gif" hidden><button type="button" class="btn upload-btn">${icon("image", 16)}<span>Wgraj zdjęcie lub gif</span></button>${p.avatar ? `<button type="button" class="btn small remove-avatar">Usuń zdjęcie</button>` : ""}</div>
      <div class="profile-fields"><div class="swatches big">${PALETTE.map((c) => `<button data-mycolor="${c}" style="--c:${c}" class="${c === p.color ? "on" : ""}" title="Kolor"></button>`).join("")}</div>
      <label>Imię i nazwisko (na kartkówkach, klasa 8K)<input data-me="fullName" value="${esc(p.fullName || "")}"></label></div></div>
      <label>Podpis odręczny do kartkówek</label>
      <div class="sig-box"><canvas class="sig" width="560" height="200"></canvas><div class="sig-actions"><button class="btn" data-sig="clear">Wyczyść</button><button class="btn primary" data-sig="save">Zapisz podpis</button>${p.signature ? `<img class="sig-preview" src="${esc(p.signature)}" alt="podpis">` : ""}</div></div>
    </section>
    <section><div class="eyebrow">Słownik pisowni</div>
      <p class="muted hint">Błędy podkreśla Pupka (czerwona falka). Kliknij podkreślone słowo, żeby wybrać poprawkę, dodać je do słownika albo zignorować. Nic nie poprawia się samo. Słowa dodane do słownika są wspólne dla was wszystkich.</p>
      <div class="dict-status" data-dict-status></div>
      <div class="dict-words">${userWords().length ? userWords().map((w) => `<span class="dict-chip">${esc(w)}<button data-rmword="${esc(w)}" title="Usuń ze słownika">${icon("close", 12)}</button></span>`).join("") : `<span class="muted">Jeszcze nic nie dodaliście.</span>`}</div>
    </section>
    <section><div class="eyebrow">Ten komputer</div>
      <button class="btn" data-go="#/switch">Zmień osobę</button>
    </section>
    <img class="watermark settings-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs">
  </main>`;
  const main = root.querySelector("main");
  const paintDict = () => {
    const el = main.querySelector("[data-dict-status]");
    if (!el) return;
    const st = spellStatus();
    const label = { idle: "jeszcze niewczytany", loading: "wczytuję…", ok: "działa", broken: "uszkodzony", error: "nie udało się wczytać" }[st.state] || st.state;
    el.innerHTML = `<span>Słownik pisowni: <b class="${st.state === "ok" ? "" : "bad"}">${esc(label)}</b>${st.detail ? ` <span class="muted">(${esc(st.detail)})</span>` : ""}</span><button class="btn small" data-dict-reload>Pobierz ponownie</button>`;
  };
  paintDict();
  loadSpeller().then(paintDict);
  main.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.set === "font") settings.set("font", t.value);
    else if (t.hasAttribute("data-mygroup")) users.set(name, Object.assign({}, myProfile(), { group: +t.value }));
    else if (t.dataset.hour != null) { const arr = hours().slice(); const v = t.value.trim(); arr[+t.dataset.hour] = /^\d{1,2}:\d{2}$/.test(v) ? v : DEFAULT_HOURS[+t.dataset.hour]; t.value = arr[+t.dataset.hour]; settings.set("hours", arr); }
    else if (t.dataset.me) { users.set(name, Object.assign({}, myProfile(), { [t.dataset.me]: t.value.trim() })); updatePresence(); }
    else if (t.type === "file") {
      const f = t.files[0]; if (!f) return;
      try { const url = await uploadImage(f, name, 320); users.set(name, Object.assign({}, myProfile(), { avatar: url })); updatePresence(); renderSettings(root); } catch (err) { alert("Nie udało się wgrać: " + err.message); }
    }
  });
  main.addEventListener("click", (e) => {
    const av = e.target.closest(".avatar-pick .avatar");
    if (av) { main.querySelector(".avatar-pick input").click(); return; }
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.rmword) { removeUserWord(b.dataset.rmword); return; }
    if (b.hasAttribute("data-dict-reload")) { b.disabled = true; b.textContent = "Pobieram…"; reloadSpeller().then(() => { if (document.body.contains(main)) paintDict(); }); return; }
    if (b.classList.contains("upload-btn")) { main.querySelector(".avatar-pick input").click(); return; }
    if (b.classList.contains("remove-avatar")) { users.set(name, Object.assign({}, myProfile(), { avatar: null })); updatePresence(); renderSettings(root); return; }
    if (b.dataset.mycolor) { users.set(name, Object.assign({}, myProfile(), { color: b.dataset.mycolor })); updatePresence(); main.querySelectorAll("[data-mycolor]").forEach((x) => x.classList.toggle("on", x === b)); main.querySelector(".avatar-pick").style.setProperty("--c", b.dataset.mycolor); main.querySelector(".avatar-pick .avatar").style.setProperty("--c", b.dataset.mycolor); }
    else if (b.dataset.go) window.dispatchEvent(new CustomEvent("pupka:switch"));
    else if (b.dataset.sig === "clear") sig.clear();
    else if (b.dataset.sig === "save") sig.save();
  });
  const sig = signaturePad(main.querySelector("canvas.sig"), async (dataUrl) => {
    try { const url = await uploadImage(new File([dataUrlToBlob(dataUrl)], "sig.png", { type: "image/png" }), name, 600); users.set(name, Object.assign({}, myProfile(), { signature: url })); let prev = main.querySelector(".sig-preview"); if (!prev) { prev = document.createElement("img"); prev.className = "sig-preview"; main.querySelector(".sig-actions").appendChild(prev); } prev.src = url; } catch (err) { alert(err.message); }
  });
  bindTopbar(root);
}

function signaturePad(canvas, onSave) {
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  let drawing = false, last = null, dirty = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)]; };
  canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } e.preventDefault(); });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; dirty = true; });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    save() { if (!dirty) return alert("Najpierw narysuj podpis."); onSave(canvas.toDataURL("image/png")); }
  };
}

export function openSearch() {
  if (document.querySelector(".search-bg")) return;
  const bg = document.createElement("div");
  bg.className = "search-bg";
  bg.innerHTML = `<div class="search">${icon("search")}<input placeholder="Szukaj we wszystkich notatkach" autofocus><div class="results"></div></div>`;
  document.body.appendChild(bg);
  const input = bg.querySelector("input");
  const res = bg.querySelector(".results");
  let items = [];
  let sel = 0;
  const close = () => bg.remove();
  function run() {
    const q = input.value.trim().toLowerCase();
    const all = allCards();
    items = (q ? all.filter((c) => (c.title || "").toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q) || (c.text || "").toLowerCase().includes(q)) : all.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 8)).slice(0, 30);
    sel = 0;
    res.innerHTML = items.length ? items.map((c, i) => {
      const s = subject(c.subject);
      let snip = "";
      if (q) { const t = c.text || ""; const k = t.toLowerCase().indexOf(q); if (k >= 0) snip = esc(t.slice(Math.max(0, k - 40), k)) + "<mark>" + esc(t.substr(k, q.length)) + "</mark>" + esc(t.slice(k + q.length, k + q.length + 60)); }
      return `<a class="result ${i === sel ? "on" : ""}" href="#/c/${c.id}" data-i="${i}"><span class="r-top"><b>${esc(c.title || c.name || "bez tematu")}</b><span class="muted">${esc(s ? s.name : "")} · ${esc(fmtDate(c.date))}${c.owner ? " · " + esc(c.owner) : ""}</span></span>${snip ? `<span class="r-snip">${snip}</span>` : ""}</a>`;
    }).join("") : `<div class="empty-list">Nic nie znalazłem.</div>`;
  }
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === "Enter") { if (items[sel]) { go("#/c/" + items[sel].id); close(); } }
  });
  function mark() { res.querySelectorAll(".result").forEach((r, i) => r.classList.toggle("on", i === sel)); res.querySelector(".result.on")?.scrollIntoView({ block: "nearest" }); }
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  res.addEventListener("click", () => close());
  run();
  setTimeout(() => input.focus(), 20);
}
