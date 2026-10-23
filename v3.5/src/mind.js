/* Mind maps: a tree laid out left and right of the centre, rendered as SVG markup, plus an outline editor with live preview. */

import { icon } from "./icons.js";

export const BRANCH = ["#c96442", "#2f7cf6", "#1fa463", "#d4a017", "#a855f7", "#0fb5c9", "#e0457b", "#8d6e3f"];
const FONT = '"Newsreader", Georgia, serif';
const STYLE = [
  { size: 19, weight: 600, maxW: 190, padX: 18, padY: 11, lineH: 23 },
  { size: 15.5, weight: 500, maxW: 145, padX: 12, padY: 7, lineH: 19 },
  { size: 14, weight: 400, maxW: 135, padX: 4, padY: 4, lineH: 17 }
];
const HGAP = 38, VGAP = 10, MARGIN = 12;

let ctx = null;
function measure(text, st) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${st.weight} ${st.size}px ${FONT}`;
  return ctx.measureText(text).width;
}
function wrap(text, st) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (cur && measure(t, st) > st.maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function cleanTree(t, depth = 0) {
  const text = String((t && t.t) || "").slice(0, 120);
  const kids = depth < 4 && t && Array.isArray(t.k) ? t.k.slice(0, depth ? 10 : 10).map((k) => cleanTree(k, depth + 1)).filter((k) => k.t.trim()) : [];
  return { t: text, k: kids };
}

export function layoutMind(tree, oneSide) {
  const nodes = [];
  function prep(n, depth, color) {
    const st = STYLE[Math.min(depth, 2)];
    const lines = wrap(n.t, st);
    const tw = Math.max(...lines.map((l) => measure(l, st)), 8);
    const node = { text: n.t, lines, depth, color, st, w: Math.ceil(tw + st.padX * 2), h: lines.length * st.lineH + st.padY * 2, kids: [] };
    node.kids = (n.k || []).map((k, i) => prep(k, depth + 1, depth === 0 ? BRANCH[i % BRANCH.length] : color));
    node.sub = node.kids.length ? Math.max(node.h, node.kids.reduce((a, k) => a + k.sub, 0) + VGAP * (node.kids.length - 1)) : node.h;
    nodes.push(node);
    return node;
  }
  const root = prep(tree, 0, "#2a2724");
  const right = [], left = [];
  let rh = 0, lh = 0;
  root.kids.forEach((k, i) => { if (oneSide || i === 0 || rh <= lh) { right.push(k); rh += k.sub + VGAP; } else { left.push(k); lh += k.sub + VGAP; } });
  const colW = (list, side) => { const w = []; const walk = (n, d) => { w[d] = Math.max(w[d] || 0, n.w); n.side = side; n.kids.forEach((k) => walk(k, d + 1)); }; list.forEach((n) => walk(n, 1)); return w; };
  const wr = colW(right, 1), wl = colW(left, -1);
  const sideH = (list) => (list.length ? list.reduce((a, k) => a + k.sub, 0) + VGAP * (list.length - 1) : 0);
  const H = Math.max(root.h, sideH(right), sideH(left));
  const extent = (w) => w.reduce((a, x, d) => (d ? a + HGAP + x : a), 0);
  const leftW = extent(wl), rightW = extent(wr);
  root.x = MARGIN + leftW; root.y = MARGIN + H / 2 - root.h / 2;
  function place(list, side, colWs, top) {
    let y = top;
    for (const n of list) {
      const d = n.depth;
      let x;
      if (side > 0) { x = root.x + root.w; for (let i = 1; i < d; i++) x += HGAP + colWs[i]; x += HGAP; }
      else { x = root.x; for (let i = 1; i < d; i++) x -= HGAP + colWs[i]; x -= HGAP + n.w; }
      n.x = x; n.y = y + n.sub / 2 - n.h / 2;
      const kidsH = n.kids.reduce((a, k) => a + k.sub, 0) + VGAP * Math.max(0, n.kids.length - 1);
      place(n.kids, side, colWs, y + n.sub / 2 - kidsH / 2);
      y += n.sub + VGAP;
    }
  }
  place(right, 1, wr, MARGIN + H / 2 - sideH(right) / 2);
  place(left, -1, wl, MARGIN + H / 2 - sideH(left) / 2);
  return { root, nodes, W: Math.ceil(leftW + root.w + rightW + MARGIN * 2), H: Math.ceil(H + MARGIN * 2) };
}

export function mindMarkup(tree, width) {
  let L = layoutMind(tree);
  if (width && L.W > width) { const R = layoutMind(tree, true); if (Math.min(1, width / R.W) > Math.min(1, width / L.W) * 1.08) L = R; }
  const k = width && L.W > width ? width / L.W : 1;
  const ox = width && L.W < width ? (width - L.W) / 2 : 0;
  const edges = [], boxes = [];
  const walk = (n) => {
    for (const c of n.kids) {
      const side = c.side;
      const x1 = side > 0 ? n.x + n.w : n.x, y1 = n.y + n.h / 2;
      const x2 = side > 0 ? c.x : c.x + c.w, y2 = c.y + c.h / 2 + (c.depth >= 2 ? c.h / 2 - 2 : 0);
      const mx = (x1 + x2) / 2;
      edges.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${c.color}" stroke-width="${c.depth === 1 ? 3 : 1.8}" stroke-linecap="round" opacity="${c.depth === 1 ? 0.9 : 0.75}"/>`);
      walk(c);
    }
  };
  walk(L.root);
  for (const n of L.nodes) {
    const st = n.st;
    const tx = n.x + n.w / 2;
    const text = `<text x="${tx}" y="${n.y + st.padY + st.size * 0.92}" text-anchor="middle" font-family='${FONT}' font-size="${st.size}" font-weight="${st.weight}" fill="${n.depth === 0 ? "#f5f1e8" : "#1d1c1a"}">${n.lines.map((l, i) => `<tspan x="${tx}" dy="${i ? st.lineH : 0}">${xml(l)}</tspan>`).join("")}</text>`;
    if (n.depth === 0) boxes.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${Math.min(n.h / 2, 22)}" fill="#2a2724"/>${text}`);
    else if (n.depth === 1) boxes.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="11" fill="${n.color}1f" stroke="${n.color}" stroke-width="1.6"/>${text}`);
    else boxes.push(`<line x1="${n.x}" y1="${n.y + n.h - 2}" x2="${n.x + n.w}" y2="${n.y + n.h - 2}" stroke="${n.color}" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>${text}`);
  }
  return { markup: `<g transform="translate(${ox},0) scale(${k})">${edges.join("")}${boxes.join("")}</g>`, W: Math.round(Math.min(L.W, width || L.W)), H: Math.ceil(L.H * k) };
}

export function toOutline(tree) {
  const out = [];
  const walk = (n, d) => { out.push("  ".repeat(d) + n.t); (n.k || []).forEach((k) => walk(k, d + 1)); };
  walk(tree, 0);
  return out.join("\n");
}

export function parseOutline(text) {
  const lines = String(text || "").split("\n").map((l) => { const m = /^(\s*)(?:[-*•–]\s+)?(.*)$/.exec(l.replace(/\t/g, "  ")); return { d: Math.floor(m[1].length / 2), t: m[2].trim() }; }).filter((l) => l.t);
  if (!lines.length) return { t: "", k: [] };
  const root = { t: lines[0].t, k: [] };
  const stack = [{ n: root, d: 0 }];
  for (const l of lines.slice(1)) {
    const d = Math.max(1, l.d);
    while (stack.length > 1 && stack[stack.length - 1].d >= d) stack.pop();
    const node = { t: l.t, k: [] };
    stack[stack.length - 1].n.k.push(node);
    stack.push({ n: node, d: Math.min(d, stack[stack.length - 1].d + 1) });
  }
  return cleanTree(root);
}

export function openMindEditor({ tree, width, onSave, onDelete }) {
  const bg = document.createElement("div");
  bg.className = "modal-bg mind-bg";
  bg.innerHTML = `<div class="modal mind-modal"><div class="mind-head"><h3>Mapa myśli</h3><span class="muted">Pierwsza linijka to środek. Tab przesuwa w prawo (poziom niżej), Shift+Tab w lewo.</span></div>
    <div class="mind-split"><textarea spellcheck="true" lang="pl"></textarea><div class="mind-prev"><svg></svg></div></div>
    <div class="modal-actions">${onDelete ? `<button class="btn ghost danger del">${icon("trash", 15)}<span>Usuń mapę</span></button><span style="flex:1"></span>` : ""}<button class="btn cancel">Anuluj</button><button class="btn primary ok">Zapisz</button></div></div>`;
  document.body.appendChild(bg);
  const ta = bg.querySelector("textarea"), sv = bg.querySelector("svg");
  ta.value = toOutline(tree);
  let raf = 0;
  const paint = () => {
    raf = 0;
    const t = parseOutline(ta.value);
    const m = mindMarkup(t.t ? t : { t: "…", k: [] }, width);
    sv.setAttribute("viewBox", `0 0 ${width} ${Math.max(m.H, 60)}`);
    sv.innerHTML = m.markup;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  paint();
  ta.addEventListener("input", schedule);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      const ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", en) === -1 ? v.length : v.indexOf("\n", en);
      const block = v.slice(ls, le).split("\n");
      const nb = block.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
      ta.value = v.slice(0, ls) + nb + v.slice(le);
      const delta = nb.length - (le - ls);
      ta.selectionStart = Math.max(ls, s + (e.shiftKey ? Math.max(-2, delta) : 2));
      ta.selectionEnd = en + delta;
      schedule();
    } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      const indent = /^\s*/.exec(v.slice(ls, s))[0] || (ls === 0 ? "  " : "");
      ta.setRangeText("\n" + indent, s, ta.selectionEnd, "end");
      schedule();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  });
  const close = () => { cancelAnimationFrame(raf); bg.remove(); };
  const save = () => { const t = parseOutline(ta.value); if (!t.t) { ta.focus(); return; } close(); onSave(t); };
  bg.querySelector(".cancel").addEventListener("click", close);
  bg.querySelector(".ok").addEventListener("click", save);
  if (onDelete) bg.querySelector(".del").addEventListener("click", () => { close(); onDelete(); });
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }, 40);
}
