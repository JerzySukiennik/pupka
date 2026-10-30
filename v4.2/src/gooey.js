/* Gooey quick picker: liquid blobs pour out of a rail button and carry the icons with a spring; crisp pill once settled. */

let filterReady = false;
function ensureFilter() {
  if (filterReady) return;
  filterReady = true;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.style.position = "absolute";
  s.innerHTML = `<defs><filter id="pupka-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>`;
  document.body.appendChild(s);
}

const SPRING = "cubic-bezier(.34,1.56,.64,1)";
let openOne = null;

export function gooey(anchor, items, { onPick, dir = "right" } = {}) {
  if (openOne && openOne.anchor === anchor) { openOne.close(); return null; }
  if (openOne) openOne.close();
  ensureFilter();
  const D = 38, GAP = 6, STEP = D + GAP, STAG = 45;
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
  const at = (p) => `left:${origin[0] + p[0] + 4}px;top:${origin[1] + p[1] + 4}px`;
  el.innerHTML = `<div class="goo-blobs"><span class="goo-pill"></span><i class="goo-b" style="${at([0, 0])}"></i>${items.map(() => `<i class="goo-b" style="${at([0, 0])}"></i>`).join("")}</div>
    <div class="goo-items"><button type="button" data-k="__origin" class="goo-origin" style="${at([0, 0])}">${anchor.innerHTML}</button>${items.map((it, i) => `<button type="button" data-k="${it.key}" class="${it.on ? "on" : ""}" title="${it.title || ""}" style="${at(pos(i))}">${it.html}</button>`).join("")}</div>`;
  const pill = el.querySelector(".goo-pill");
  pill.style.left = "4px"; pill.style.top = "4px"; pill.style.width = W + "px"; pill.style.height = H + "px";
  document.body.appendChild(el);
  const blobs = Array.from(el.querySelectorAll(".goo-b")).slice(1);
  const btns = Array.from(el.querySelectorAll(".goo-items button")).slice(1);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = reduce ? 1 : 560;
  blobs.forEach((b, i) => {
    const [x, y] = pos(i);
    b.animate([{ transform: "translate(0,0) scale(.55)" }, { transform: `translate(${x}px,${y}px) scale(1)` }], { duration: dur, delay: i * STAG, easing: SPRING, fill: "both" });
  });
  const btnAnims = btns.map((b, i) => {
    const [x, y] = pos(i);
    return b.animate([{ transform: `translate(${-x}px,${-y}px) scale(.3) rotate(-70deg)`, opacity: 0 }, { opacity: 1, offset: .35 }, { transform: "none", opacity: 1 }], { duration: dur + 60, delay: 30 + i * STAG, easing: SPRING, fill: "both" });
  });
  anchor.animate([{ transform: "scale(1)" }, { transform: "scale(.86)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
  const settle = setTimeout(() => { el.classList.add("settled"); btnAnims.forEach((a) => a.cancel()); }, dur + n * STAG + 100);
  anchor.classList.add("goo-open");
  let closed = false;
  function close(picked) {
    if (closed) return;
    closed = true;
    clearTimeout(settle);
    anchor.classList.remove("goo-open");
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    if (openOne && openOne.el === el) openOne = null;
    el.classList.remove("settled");
    el.style.pointerEvents = "none";
    const last = n - 1;
    const back = reduce ? 1 : 300;
    blobs.forEach((b, i) => b.animate([{ transform: `translate(${pos(i)[0]}px,${pos(i)[1]}px) scale(1)` }, { transform: "translate(0,0) scale(.5)" }], { duration: back, delay: (last - i) * 30, easing: "cubic-bezier(.55,0,.75,.2)", fill: "both" }));
    btns.forEach((b, i) => {
      const [x, y] = pos(i);
      const isPicked = picked && b.dataset.k === picked;
      b.animate(isPicked
        ? [{ transform: "none", opacity: 1 }, { transform: "scale(1.3)", opacity: 1, offset: .35 }, { transform: `translate(${-x}px,${-y}px) scale(.6)`, opacity: 0 }]
        : [{ transform: "none", opacity: 1 }, { transform: `translate(${-x}px,${-y}px) scale(.3) rotate(-50deg)`, opacity: 0 }], { duration: isPicked ? back + 120 : back, delay: isPicked ? 0 : (last - i) * 30, easing: "cubic-bezier(.55,0,.75,.2)", fill: "both" });
    });
    setTimeout(() => el.remove(), back + n * 30 + 160);
    if (picked) anchor.animate([{ transform: "scale(1)" }, { transform: "scale(1.18) rotate(-8deg)", offset: .5 }, { transform: "scale(1)" }], { duration: 420, delay: back - 60, easing: SPRING });
  }
  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener("pointerdown", onDoc, true); document.addEventListener("keydown", onKey, true); }, 0);
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.k; close(k !== "__origin" ? k : null); if (k !== "__origin") onPick && onPick(k); });
  openOne = { anchor, el, close: () => close() };
  return () => close();
}

export function closeGooey() { if (openOne) openOne.close(); }
