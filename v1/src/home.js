/* Screens outside the editor: person picker, home, subject, plan, trash, settings, search. */

import { NAMES, PALETTE, FONTS, DAYS, DEFAULT_HOURS, users, settings, plan, listSubjects, listCards, allCards, subject, card, createSubject, updateSubject, reorderSubjects, createLesson, createTest, updateCard, trashCard, trashSubject, restoreCard, restoreSubject, trashItems, presence, setMe, me, myProfile, nowLesson, hours, today, fmtDate, fmtDateLong, updatePresence, state, onChange } from "./store.js";
import { uploadImage, dataUrlToBlob } from "./net.js";
import { topbar, avatarHtml, presenceHtml } from "./ui.js";
import { esc } from "./md.js";

function go(hash) { location.hash = hash; }

export function renderPicker(root, onPicked) {
  const el = document.createElement("div");
  el.className = "picker";
  const draw = () => {
    el.innerHTML = `<div class="picker-box"><div class="picker-logo">Pupka</div><div class="picker-sub">Kto pisze?</div><div class="picker-tiles">${NAMES.map((n) => {
      const p = users.get(n) || {};
      return `<button class="tile" data-name="${n}" style="--c:${p.color || "#555"}">${avatarHtml({ name: n, color: p.color, avatar: p.avatar }, 84)}<span class="tile-name">${n}</span></button>`;
    }).join("")}</div><div class="picker-net">${state.online ? "połączono" : "łączę… (offline też działa)"}</div><img class="watermark picker-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs"></div>`;
  };
  draw();
  const obs = () => { if (!el.querySelector(".setup")) draw(); else { const n = el.querySelector(".picker-net"); if (n) n.textContent = state.online ? "połączono" : "łączę… (offline też działa)"; } };
  users.observe(obs);
  const offStatus = onChange((k) => { if (k === "status") obs(); });
  el.addEventListener("click", (e) => {
    const t = e.target.closest(".tile");
    if (!t) return;
    const name = t.dataset.name;
    const p = users.get(name) || {};
    if (p.color) { finish(name); return; }
    setup(name);
  });
  function finish(name) { users.unobserve(obs); offStatus(); el.remove(); setMe(name); onPicked(); }
  function setup(name) {
    const box = el.querySelector(".picker-box");
    let color = PALETTE[NAMES.indexOf(name)] || PALETTE[0];
    let avatar = null;
    box.innerHTML = `<div class="picker-logo">Cześć, ${name}</div><div class="picker-sub">Pierwszy raz: ustaw kolor i zdjęcie. Potem już tylko klikasz.</div>
      <div class="setup">
        <label class="avatar-pick" style="--c:${color}">${avatarHtml({ name, color }, 96)}<input type="file" accept="image/*,.gif" hidden><span>zdjęcie profilowe (może być gif)</span></label>
        <div class="swatches big">${PALETTE.map((c) => `<button data-color="${c}" style="--c:${c}" class="${c === color ? "on" : ""}"></button>`).join("")}</div>
        <input class="fullname" placeholder="Imię i nazwisko (do kartkówek)" value="${esc((users.get(name) || {}).fullName || "")}">
        <button class="primary done">Gotowe</button>
      </div>`;
    const pick = box.querySelector(".avatar-pick");
    const file = pick.querySelector("input");
    pick.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      pick.classList.add("busy");
      try { avatar = await uploadImage(f, name, 320); pick.querySelector(".avatar").innerHTML = `<img src="${avatar}" alt="">`; } catch (e) { alert(e.message); }
      pick.classList.remove("busy");
    });
    box.querySelector(".swatches").addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      color = b.dataset.color;
      box.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
      pick.style.setProperty("--c", color);
      pick.querySelector(".avatar").style.setProperty("--c", color);
    });
    box.querySelector(".done").addEventListener("click", () => {
      const prev = users.get(name) || {};
      users.set(name, Object.assign({}, prev, { color, avatar: avatar || prev.avatar || null, fullName: box.querySelector(".fullname").value.trim() || name }));
      finish(name);
    });
  }
  root.appendChild(el);
}

function homeRight() {
  const p = myProfile();
  const online = presence().map((s) => s.user);
  return `${presenceHtml(online, 26)}<span class="net ${state.online ? "on" : ""}"></span><button class="icon-btn" data-go="#/search" title="Szukaj (Cmd+K)">⌕</button><button class="icon-btn" data-go="#/plan" title="Plan lekcji">▦</button><button class="icon-btn" data-go="#/trash" title="Kosz">🗑</button><button class="icon-btn" data-go="#/settings" title="Ustawienia">⚙</button><button class="me-btn" data-go="#/switch" title="Zmień osobę">${avatarHtml({ name: me(), color: p.color, avatar: p.avatar }, 28)}</button>`;
}

function whoOn(cardId) { return presence().filter((s) => s.card === cardId).map((s) => s.user); }
function whoOnSubject(sid) { const ids = new Set(listCards(sid).map((c) => c.id)); return presence().filter((s) => s.card && ids.has(s.card)).map((s) => s.user); }

export function renderHome(root) {
  const now = nowLesson();
  const subs = listSubjects();
  const todayCard = now && now.subject ? listCards(now.subject.id, "lesson").find((c) => c.date === today()) : null;
  root.innerHTML = `${topbar({ title: `<span class="date-now">${esc(fmtDateLong(today()))}</span>`, right: homeRight() })}
  <main class="home">
    ${now && now.subject ? `<section class="now"><div><span class="now-label">Teraz · ${esc(now.time)}</span><h2>${esc(now.subject.emoji || "")} ${esc(now.subject.name)}</h2></div><div class="now-actions">${todayCard ? `<button class="primary" data-open="${todayCard.id}">Otwórz dzisiejszą lekcję</button>` : ""}<button class="${todayCard ? "" : "primary"}" data-new-lesson="${now.subject.id}">Nowa lekcja</button></div></section>` : (plan.size ? "" : `<section class="now hint"><div><span class="now-label">Plan lekcji</span><h2>Wpisz plan, a Pupka sama otworzy właściwy przedmiot</h2></div><div class="now-actions"><button data-go="#/plan">Uzupełnij plan</button></div></section>`)}
    <div class="subjects">
      ${subs.map((s) => {
        const lessons = listCards(s.id, "lesson");
        const tests = listCards(s.id, "test");
        const last = lessons[0];
        return `<a class="subject-tile" href="#/s/${s.id}"><div class="st-top"><span class="st-emoji">${esc(s.emoji || "")}</span><span class="st-name">${esc(s.name)}</span><button class="icon-btn st-menu" data-subject-menu="${s.id}" title="Opcje">…</button></div><div class="st-meta">${lessons.length} ${plural(lessons.length, "lekcja", "lekcje", "lekcji")}${tests.length ? ` · ${Math.round(tests.length / 3)} na ocenę` : ""}</div><div class="st-last">${last ? `${esc(fmtDate(last.date))} · ${esc(last.title || "bez tematu")}` : "jeszcze pusto"}</div><div class="st-presence">${presenceHtml(whoOnSubject(s.id), 22)}</div></a>`;
      }).join("")}
      <button class="subject-tile new" data-new-subject><span class="st-plus">+</span><span>Nowy przedmiot</span></button>
    </div>
    <img class="watermark home-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs">
  </main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.open) go("#/c/" + b.dataset.open);
    else if (b.dataset.newLesson) go("#/c/" + createLesson(b.dataset.newLesson));
    else if (b.dataset.go) go(b.dataset.go);
    else if (b.hasAttribute("data-new-subject")) newSubjectDialog();
    else if (b.dataset.subjectMenu) subjectMenu(b, b.dataset.subjectMenu);
  });
  bindTopbar(root);
}

function plural(n, a, b, c) { if (n === 1) return a; const m = n % 10, h = n % 100; return m >= 2 && m <= 4 && !(h >= 12 && h <= 14) ? b : c; }

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

function newSubjectDialog() {
  const name = prompt("Nazwa przedmiotu:");
  if (!name || !name.trim()) return;
  const emoji = prompt("Emoji (opcjonalnie):", "") || "";
  go("#/s/" + createSubject(name.trim(), emoji.trim()));
}

function subjectMenu(anchor, sid) {
  const s = subject(sid);
  if (!s) return;
  popMenu(anchor, [
    ["Zmień nazwę", () => { const n = prompt("Nazwa:", s.name); if (n && n.trim()) updateSubject(sid, { name: n.trim() }); }],
    ["Zmień emoji", () => { const e = prompt("Emoji:", s.emoji || ""); if (e != null) updateSubject(sid, { emoji: e.trim() }); }],
    ["Przesuń wyżej", () => { const ids = listSubjects().map((x) => x.id); const i = ids.indexOf(sid); if (i > 0) { ids.splice(i, 1); ids.splice(i - 1, 0, sid); reorderSubjects(ids); } }],
    ["Przesuń niżej", () => { const ids = listSubjects().map((x) => x.id); const i = ids.indexOf(sid); if (i < ids.length - 1) { ids.splice(i, 1); ids.splice(i + 1, 0, sid); reorderSubjects(ids); } }],
    ["Do kosza", () => { if (confirm(`Przenieść "${s.name}" ze wszystkimi kartami do kosza?`)) { trashSubject(sid); go("#/"); } }, "danger"]
  ]);
}

export function popMenu(anchor, items) {
  const m = document.createElement("div");
  m.className = "pop-menu";
  m.innerHTML = items.map(([label, , cls], i) => `<button data-i="${i}" class="${cls || ""}">${esc(label)}</button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = r.bottom + 6 + "px";
  const close = () => { m.remove(); document.removeEventListener("mousedown", onDoc); };
  const onDoc = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
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
  root.innerHTML = `${topbar({ back: "#/", title: `<span class="subj-title">${esc(s.emoji || "")} ${esc(s.name)}</span>`, right: homeRight() })}
  <main class="subject">
    <div class="tabs"><a href="#/s/${sid}" class="${isTests ? "" : "on"}">Lekcje</a><a href="#/s/${sid}?tab=tests" class="${isTests ? "on" : ""}">Na ocenę</a></div>
    ${isTests ? `
      <div class="list-head"><button class="primary" data-new-test>Nowa kartkówka / sprawdzian</button><span class="muted">Każdy test to trzy karty, po jednej na osobę. Cudzą można tylko oglądać.</span></div>
      <div class="test-list">${groups.length ? groups.map((g) => `<div class="test-row"><div class="test-info"><span class="test-kind">${esc(g.kind)}</span><span class="test-name">${esc(g.name)}</span><span class="muted">${esc(fmtDate(g.date))}</span></div><div class="test-cards">${NAMES.map((n) => { const c = g.cards.find((x) => x.owner === n); const p = users.get(n) || {}; return c ? `<a class="chip ${n === me() ? "mine" : ""}" href="#/c/${c.id}" style="--c:${p.color || "#888"}">${avatarHtml({ name: n, color: p.color, avatar: p.avatar }, 22)}${n}${presenceHtml(whoOn(c.id), 18)}</a>` : ""; }).join("")}<button class="icon-btn" data-test-menu="${g.group}" title="Opcje">…</button></div></div>`).join("") : `<div class="empty-list">Jeszcze nic na ocenę.</div>`}</div>
    ` : `
      <div class="list-head"><button class="primary" data-new-lesson>Nowa lekcja</button><span class="muted">${lessons.length} ${plural(lessons.length, "lekcja", "lekcje", "lekcji")}</span></div>
      <div class="card-list">${lessons.length ? lessons.map((c) => `<a class="card-row" href="#/c/${c.id}"><span class="cr-date">${esc(fmtDate(c.date))}</span><span class="cr-title">${esc(c.title || "bez tematu")}</span><span class="cr-presence">${presenceHtml(whoOn(c.id), 20)}</span><button class="icon-btn" data-card-menu="${c.id}" title="Opcje">…</button></a>`).join("") : `<div class="empty-list">Pusto. Kliknij „Nowa lekcja”.</div>`}</div>
    `}
  </main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    if (b.hasAttribute("data-new-lesson")) go("#/c/" + createLesson(sid));
    else if (b.hasAttribute("data-new-test")) newTestDialog(sid);
    else if (b.dataset.cardMenu) {
      const c = card(b.dataset.cardMenu);
      popMenu(b, [
        ["Zmień datę", () => { const d = prompt("Data (RRRR-MM-DD):", c.date); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) updateCard(c.id, { date: d }); }],
        ["Do kosza", () => { trashCard(c.id); }, "danger"]
      ]);
    } else if (b.dataset.testMenu) {
      const g = groups.find((x) => x.group === b.dataset.testMenu);
      popMenu(b, [["Do kosza (wszystkie 3)", () => { if (confirm(`Przenieść "${g.name}" do kosza?`)) g.cards.forEach((c) => trashCard(c.id)); }, "danger"]]);
    }
  });
  bindTopbar(root);
}

function newTestDialog(sid) {
  const box = document.createElement("div");
  box.className = "modal-bg";
  box.innerHTML = `<div class="modal"><h3>Nowy test</h3><label>Rodzaj<select><option value="kartkówka">Kartkówka</option><option value="sprawdzian">Sprawdzian</option></select></label><label>Nazwa<input placeholder="np. Genetyka, dział 2" autofocus></label><div class="modal-actions"><button class="cancel">Anuluj</button><button class="primary ok">Utwórz 3 karty</button></div></div>`;
  document.body.appendChild(box);
  const input = box.querySelector("input");
  setTimeout(() => input.focus(), 30);
  const close = () => box.remove();
  box.querySelector(".cancel").addEventListener("click", close);
  box.addEventListener("mousedown", (e) => { if (e.target === box) close(); });
  const ok = () => { const n = input.value.trim(); if (!n) return input.focus(); const id = createTest(sid, n, box.querySelector("select").value); close(); go("#/c/" + id); };
  box.querySelector(".ok").addEventListener("click", ok);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") close(); });
}

export function renderPlan(root) {
  const hs = hours();
  const subs = listSubjects();
  root.innerHTML = `${topbar({ back: "#/", title: "Plan lekcji", right: homeRight() })}
  <main class="plan"><p class="muted">Kliknij komórkę i wybierz przedmiot. Godziny zmienisz w ustawieniach.</p>
  <table class="plan-grid"><thead><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>${hs.map((h, i) => `<tr><th>${i + 1}<small>${esc(h)}</small></th>${DAYS.map((_, d) => { const sid = plan.get(`${d + 1}-${i}`); const s = sid ? subject(sid) : null; return `<td><button data-cell="${d + 1}-${i}" class="${s ? "" : "empty"}">${s ? `${esc(s.emoji || "")} ${esc(s.name)}` : "·"}</button></td>`; }).join("")}</tr>`).join("")}</tbody></table></main>`;
  root.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cell]");
    if (!b) return;
    popMenu(b, subs.map((s) => [`${s.emoji || ""} ${s.name}`.trim(), () => plan.set(b.dataset.cell, s.id)]).concat([["— pusto", () => plan.delete(b.dataset.cell), "muted"]]));
  });
  bindTopbar(root);
}

export function renderTrash(root) {
  const items = trashItems();
  root.innerHTML = `${topbar({ back: "#/", title: "Kosz", right: homeRight() })}
  <main class="trash"><p class="muted">Rzeczy znikają na dobre po 30 dniach.</p>
  <div class="card-list">${items.length ? items.map((it) => `<div class="card-row"><span class="cr-date">${it.type === "subject" ? "przedmiot" : esc(fmtDate(it.date))}</span><span class="cr-title">${esc(it.type === "subject" ? `${it.emoji || ""} ${it.name}` : (it.title || it.name || "bez tematu"))}${it.type === "card" && subject(it.subject) ? ` <small class="muted">· ${esc(subject(it.subject).name)}${it.owner ? " · " + esc(it.owner) : ""}</small>` : ""}</span><button data-restore="${it.type}:${it.id}">Przywróć</button></div>`).join("") : `<div class="empty-list">Kosz jest pusty.</div>`}</div></main>`;
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
  root.innerHTML = `${topbar({ back: "#/", title: "Ustawienia", right: homeRight() })}
  <main class="settings">
    <section><h3>Wspólne</h3>
      <label>Domyślna czcionka<select data-set="font">${FONTS.map((f) => `<option ${(settings.get("font") || "Montserrat") === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label>Godziny lekcji (start każdej)<div class="hours">${hs.map((h, i) => `<input data-hour="${i}" value="${esc(h)}" size="5">`).join("")}</div></label>
    </section>
    <section><h3>Ja: ${esc(name)}</h3>
      <div class="profile-row"><label class="avatar-pick" style="--c:${p.color || "#555"}">${avatarHtml({ name, color: p.color, avatar: p.avatar }, 80)}<input type="file" accept="image/*,.gif" hidden><span>zmień zdjęcie (lub gif)</span></label>
      <div><div class="swatches big">${PALETTE.map((c) => `<button data-mycolor="${c}" style="--c:${c}" class="${c === p.color ? "on" : ""}"></button>`).join("")}</div>
      <label>Imię i nazwisko<input data-me="fullName" value="${esc(p.fullName || "")}"></label></div></div>
      <label>Podpis odręczny (do kartkówek)</label>
      <div class="sig-box"><canvas class="sig" width="560" height="200"></canvas><div class="sig-actions"><button data-sig="clear">Wyczyść</button><button data-sig="save" class="primary">Zapisz podpis</button>${p.signature ? `<img class="sig-preview" src="${esc(p.signature)}" alt="podpis">` : ""}</div></div>
    </section>
    <section><h3>Ten komputer</h3>
      <label class="check"><input type="checkbox" data-local="straighten" ${localStorage.getItem("pupka-straighten") !== "0" ? "checked" : ""}> Prostuj odręczne kształty (prostokąt, koło, linia)</label>
      <button data-go="#/switch">Zmień osobę</button>
    </section>
    <img class="watermark settings-wm" src="assets/gzowo-labs-fire.gif" alt="Gzowo Labs">
  </main>`;
  const main = root.querySelector("main");
  main.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.set === "font") settings.set("font", t.value);
    else if (t.dataset.hour != null) { const arr = hours().slice(); arr[+t.dataset.hour] = t.value.trim() || DEFAULT_HOURS[+t.dataset.hour]; settings.set("hours", arr); }
    else if (t.dataset.me) { users.set(name, Object.assign({}, myProfile(), { [t.dataset.me]: t.value.trim() })); updatePresence(); }
    else if (t.dataset.local === "straighten") localStorage.setItem("pupka-straighten", t.checked ? "1" : "0");
    else if (t.type === "file") {
      const f = t.files[0]; if (!f) return;
      try { const url = await uploadImage(f, name, 320); users.set(name, Object.assign({}, myProfile(), { avatar: url })); updatePresence(); main.querySelector(".avatar-pick .avatar").innerHTML = `<img src="${url}" alt="">`; } catch (err) { alert(err.message); }
    }
  });
  main.addEventListener("click", (e) => {
    const b = e.target.closest("button, .avatar-pick");
    if (!b) return;
    if (b.classList.contains("avatar-pick")) { b.querySelector("input").click(); return; }
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
  canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
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
  bg.innerHTML = `<div class="search"><input placeholder="Szukaj we wszystkich notatkach…" autofocus><div class="results"></div></div>`;
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
