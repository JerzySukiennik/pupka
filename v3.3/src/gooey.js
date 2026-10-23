/* Gooey quick picker: icon blobs flow out of a rail button (SVG goo filter while moving, crisp once settled). */

let filterReady = false;
function ensureFilter() {
  if (filterReady) return;
  filterReady = true;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.style.position = "absolute";
  s.innerHTML = `<defs><filter id="pupka-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>`;
  document.body.appendChild(s);
}

let openOne = null;

export function gooey(anchor, items, { onPick, dir = "right" } = {}) {
  if (openOne && openOne.anchor === anchor) { openOne.close(); return null; }
  if (openOne) openOne.close();
  ensureFilter();
  const D = 38, GAP = 5, STEP = D + GAP;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "goo goo-" + dir;
  const vertical = dir === "up";
  const n = items.length;
  const W = vertical ? D : STEP * n + D, H = vertical ? STEP * n + D : D;
  el.style.width = W + 8 + "px";
  el.style.height = H + 8 + "px";
  if (vertical) { el.style.left = r.left + r.width / 2 - D / 2 - 4 + "px"; el.style.top = r.top + r.height / 2 - H + D / 2 - 4 + "px"; }
  else { el.style.left = r.left + r.width / 2 - D / 2 - 4 + "px"; el.style.top = r.top + r.height / 2 - D / 2 - 4 + "px"; }
  const pos = (i) => (vertical ? [0, -(i + 1) * STEP] : [(i + 1) * STEP, 0]);
  const origin = vertical ? [0, H - D] : [0, 0];
  el.innerHTML = `<div class="goo-blobs"><span class="goo-pill"></span><i class="goo-b" style="left:${origin[0] + 4}px;top:${origin[1] + 4}px"></i>${items.map(() => `<i class="goo-b" style="left:${origin[0] + 4}px;top:${origin[1] + 4}px"></i>`).join("")}</div>
    <div class="goo-items"><button type="button" data-k="__origin" class="goo-origin" style="left:${origin[0] + 4}px;top:${origin[1] + 4}px">${anchor.innerHTML}</button>${items.map((it, i) => `<button type="button" data-k="${it.key}" class="${it.on ? "on" : ""}" title="${it.title || ""}" style="left:${origin[0] + pos(i)[0] + 4}px;top:${origin[1] + pos(i)[1] + 4}px;--d:${i * 28}ms">${it.html}</button>`).join("")}</div>`;
  const pill = el.querySelector(".goo-pill");
  pill.style.left = "4px"; pill.style.top = "4px"; pill.style.width = W + "px"; pill.style.height = H + "px";
  document.body.appendChild(el);
  const blobs = Array.from(el.querySelectorAll(".goo-b")).slice(1);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add("in");
    blobs.forEach((b, i) => { b.style.transitionDelay = i * 28 + "ms"; b.style.transform = `translate(${pos(i)[0]}px,${pos(i)[1]}px)`; });
  }));
  const settle = setTimeout(() => el.classList.add("settled"), 300 + n * 28);
  anchor.classList.add("goo-open");
  function close() {
    clearTimeout(settle);
    anchor.classList.remove("goo-open");
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    el.classList.remove("settled", "in");
    el.classList.add("out");
    blobs.forEach((b) => { b.style.transitionDelay = "0ms"; b.style.transform = "translate(0,0)"; });
    setTimeout(() => el.remove(), 260);
    if (openOne && openOne.el === el) openOne = null;
  }
  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener("pointerdown", onDoc, true); document.addEventListener("keydown", onKey, true); }, 0);
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; close(); if (b.dataset.k !== "__origin") onPick && onPick(b.dataset.k); });
  openOne = { anchor, el, close };
  return close;
}

export function closeGooey() { if (openOne) openOne.close(); }
