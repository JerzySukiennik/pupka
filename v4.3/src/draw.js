/* Drawing layer over the editor: strokes live in a Y.Map, anchored to the text block under their first point,
   rendered as SVG groups whose translate follows the block. Pen, highlighter, eraser, lasso, shapes, labels. */

import { Y, getStroke } from "../lib/vendor.js";
import { uid } from "./store.js";
import { loadPixels, floodRegion, maskToRings } from "./fill.js";
import { mindMarkup } from "./mind.js";

export const SIZES = [2, 4, 8];
export const COLORS = ["#111111", "#2f7cf6", "#e03131", "#1fa463", "#f28c28", "#a855f7", "#0fb5c9", "#ffd43b"];
const ERASE_R = 9;
const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  return el;
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) { const a = rdp(pts.slice(0, idx + 1), eps), b = rdp(pts.slice(idx), eps); return a.slice(0, -1).concat(b); }
  return [pts[0], pts[pts.length - 1]];
}

function outlinePath(pts, size) {
  const stroke = getStroke(pts, { size, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: pts.length > 2 && pts[0].length < 3, last: true });
  if (!stroke.length) return "";
  const d = stroke.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); return acc; }, ["M", ...stroke[0], "Q"]);
  d.push("Z");
  return d.map((v) => typeof v === "number" ? Math.round(v * 10) / 10 : v).join(" ");
}

function arrowHead(a, b, w) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = Math.max(10, w * 4);
  const p1 = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)];
  const p2 = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
  return `${b[0]},${b[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
}


function smoothCurve(pts) {
  if (pts.length < 3) return pts;
  const o = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let t = 0; t < 1; t += 0.125) {
      const t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      o.push([Math.round(f(0) * 10) / 10, Math.round(f(1) * 10) / 10]);
    }
  }
  o.push(pts[pts.length - 1]);
  return o;
}

export function createDraw({ pageEl, pmEl, ydoc, provider, name, color, canEdit, onChange, undoManager }) {
  const strokes = ydoc.getMap("strokes");
  const ownUndo = !undoManager;
  const undo = undoManager || new Y.UndoManager(strokes, { trackedOrigins: new Set(["draw"]), captureTimeout: 0 });
  const tx = (fn) => { undo.stopCapturing(); ydoc.transact(fn, "draw"); undo.stopCapturing(); };
  const layer = document.createElement("div");
  layer.className = "draw-layer";
  const svgStatic = svg("svg", { class: "strokes" });
  const svgLive = svg("svg", { class: "live" });
  const capture = document.createElement("div");
  capture.className = "draw-capture";
  layer.append(svgStatic, svgLive, capture);
  (pmEl.parentElement || pageEl).appendChild(layer);

  const st = {
    active: false, tool: "pen", color: color || "#111", size: 4,
    grid: localStorage.getItem("pupka-grid") === "1",
    selection: new Set(), clipboard: null, drawing: null, spaceDown: false,
    eraseMode: localStorage.getItem("pupka-erase") === "stroke" ? "stroke" : "part"
  };
  pageEl.classList.toggle("grid", st.grid);
  const els = new Map();
  let tops = new Map();
  let raf = 0;

  let imgs = new Map();
  let pmW = 640;
  function layout() {
    tops = new Map();
    pmW = pmEl.clientWidth || pmW;
    for (const el of pmEl.children) if (el.dataset && el.dataset.bid) tops.set(el.dataset.bid, el.offsetTop);
    imgs = new Map();
    const pr = pmEl.getBoundingClientRect();
    pmEl.querySelectorAll(".img-figure").forEach((fig) => {
      const im = fig.querySelector("img");
      if (!im || !fig.dataset.bid) return;
      const r = im.getBoundingClientRect();
      imgs.set(fig.dataset.bid, { left: r.left - pr.left, top: r.top - pr.top, w: r.width, h: r.height });
    });
    let lowest = 0;
    strokes.forEach((s) => { for (const pt of absPts(s)) lowest = Math.max(lowest, pt[1] + (s.t === "label" ? 8 : (s.w || 4) * 2)); });
    let contentBottom = 0;
    for (const el of pmEl.children) contentBottom = Math.max(contentBottom, el.offsetTop + el.offsetHeight);
    pmEl.style.setProperty("--draw-extra", Math.max(0, Math.round(lowest + 24 - contentBottom)) + "px");
  }
  function topOf(s) { const t = tops.get(s.bid); return t == null ? (s.fy || 0) : t; }
  function anchorFor(y) {
    let best = null, bestTop = -Infinity;
    for (const [bid, top] of tops) if (top <= y && top > bestTop) { best = bid; bestTop = top; }
    if (best == null) return { bid: null, top: 0 };
    return { bid: best, top: bestTop };
  }
  function frame(s) {
    if (s.t === "mind") return { ox: 0, oy: topOf(s), k: Math.min(1, pmW / (s.W || pmW)) };
    if (s.a) {
      const im = imgs.get(s.a);
      if (!im || im.w < 2) return null;
      return { ox: im.left, oy: im.top, k: s.aw ? im.w / s.aw : 1 };
    }
    return { ox: 0, oy: topOf(s), k: 1 };
  }
  function absPts(s) { const f = frame(s); if (!f) return []; return s.p.map(([x, y]) => [f.ox + x * f.k, f.oy + y * f.k]); }
  function imageAt(pt) {
    let hit = null;
    for (const [bid, r] of imgs) if (r.w > 20 && pt[0] >= r.left && pt[0] <= r.left + r.w && pt[1] >= r.top && pt[1] <= r.top + r.h) hit = { bid, r };
    return hit;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  function record(absPoints, base) {
    const b = Object.assign({}, base);
    delete b.a; delete b.aw; delete b.bid; delete b.fy;
    const hit = imageAt(absPoints[0]);
    if (hit) return Object.assign(b, { a: hit.bid, aw: r1(hit.r.w), p: absPoints.map(([x, y]) => [r1(x - hit.r.left), r1(y - hit.r.top)]) });
    const { bid, top } = anchorFor(absPoints[0][1]);
    return Object.assign(b, { bid, fy: top, p: absPoints.map(([x, y]) => [r1(x), r1(y - top)]) });
  }

  function build(id, s) {
    const g = svg("g", { "data-id": id });
    const w = s.w || 4;
    if (s.t === "pen") g.appendChild(svg("path", { d: outlinePath(s.p, w), fill: s.c }));
    else if (s.t === "hl") g.appendChild(svg("polyline", { points: s.p.map((p) => p.join(",")).join(" "), fill: "none", stroke: s.c, "stroke-width": w * 4, "stroke-linecap": "butt", "stroke-linejoin": "round", opacity: 0.4, style: "mix-blend-mode:multiply" }));
    else if (s.t === "line" || s.t === "arrow") {
      const [a, b] = s.p;
      g.appendChild(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: s.c, "stroke-width": w, "stroke-linecap": "round" }));
      if (s.t === "arrow") g.appendChild(svg("polygon", { points: arrowHead(a, b, w), fill: s.c }));
    } else if (s.t === "rect") {
      const [a, b] = s.p;
      g.appendChild(svg("rect", { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), fill: s.f || "none", stroke: s.c, "stroke-width": w, rx: 2 }));
    } else if (s.t === "ellipse") {
      const [a, b] = s.p;
      g.appendChild(svg("ellipse", { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2, fill: s.f || "none", stroke: s.c, "stroke-width": w }));
    } else if (s.t === "area") {
      const rings = []; let o = 0;
      for (const n of (s.r && s.r.length ? s.r : [s.p.length])) { rings.push(s.p.slice(o, o + n)); o += n; }
      const d = rings.filter((r) => r.length > 2).map((r) => "M" + r.map((q) => q[0] + "," + q[1]).join("L") + "Z").join("");
      g.appendChild(svg("path", { d, fill: s.f || s.c || "#2f7cf6", "fill-opacity": s.o == null ? 0.45 : s.o, "fill-rule": "evenodd", stroke: "none" }));
    } else if (s.t === "poly") {
      g.appendChild(svg(s.closed ? "polygon" : "polyline", { points: s.p.map((p) => p.join(",")).join(" "), fill: s.f || "none", stroke: s.c, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    } else if (s.t === "mind") {
      const m = mindMarkup(s.tree || { t: "", k: [] }, s.W || 640);
      g.innerHTML = m.markup;
      if (s.bid) mindH.set(s.bid, m.H);
    } else if (s.t === "label") {
      const [x, y] = s.p[0];
      const text = svg("text", { x, y, fill: s.c, "font-size": s.w || 16, class: "draw-label", stroke: "#ffffff", "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round" });
      String(s.txt || "").split("\n").forEach((line, i) => { const ts = svg("tspan", { x, dy: i ? "1.25em" : 0 }); ts.textContent = line; text.appendChild(ts); });
      g.appendChild(text);
    }
    return g;
  }
  function place(id) {
    const e = els.get(id);
    if (!e) return;
    const f = frame(e.s);
    e.g.setAttribute("transform", f ? `translate(${r1(f.ox)},${r1(f.oy)})${f.k !== 1 ? ` scale(${f.k})` : ""}` : "");
    e.g.style.display = !f || (e.s.sp && !tops.has(e.s.bid)) ? "none" : "";
    e.g.classList.toggle("selected", st.selection.has(id));
  }
  function renderAll() {
    for (const id of Array.from(els.keys())) if (!strokes.has(id)) { els.get(id).g.remove(); els.delete(id); }
    strokes.forEach((s, id) => {
      const e = els.get(id);
      if (!e || e.s !== s) { if (e) e.g.remove(); const g = build(id, s); if (s.t === "area") svgStatic.insertBefore(g, svgStatic.firstChild); else svgStatic.appendChild(g); els.set(id, { g, s }); }
      place(id);
    });
    drawSelection();
    pmEl.querySelectorAll(".draw-spacer").forEach((sp) => {
      const m = sp.dataset.bid && mindBids.get(sp.dataset.bid);
      sp.classList.toggle("has-mind", !!m);
      const mh = m && (mindH.get(sp.dataset.bid) || m.H);
      if (m && m.W && mh) { const h = Math.round(mh * Math.min(1, pmW / m.W) + 16) + "px"; if (sp.style.height !== h) sp.style.height = h; }
    });
  }
  let mindBids = new Map();
  const mindH = new Map();
  const indexMinds = () => { mindBids = new Map(); strokes.forEach((s) => { if (s.t === "mind" && s.bid) mindBids.set(s.bid, s); }); };
  strokes.observe(indexMinds);
  indexMinds();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const [id, e] of els) if (e.s.t === "mind") { e.g.remove(); els.delete(id); } schedule(); });
  function schedule() {
    if (raf) return;
    const run = () => { if (!raf) return; raf = 0; layout(); renderAll(); };
    raf = requestAnimationFrame(run);
    setTimeout(() => { if (raf) { cancelAnimationFrame(raf); run(); } }, 120);
  }
  let migTimer = 0;
  strokes.observe(() => { schedule(); clearTimeout(migTimer); migTimer = setTimeout(() => { try { migrateLegacy(); } catch (e) { /* not ready */ } }, 500); });
  const ro = new ResizeObserver(() => schedule());
  ro.observe(pmEl);
  const migrated = new Set();
  function migrateLegacy() {
    if (!canEdit()) return;
    const todo = [];
    strokes.forEach((s, id) => {
      if (s.a || !s.bid || migrated.has(id) || !imgs.has(s.bid)) return;
      const ap = absPts(s);
      if (!ap.length) return;
      const hit = imageAt(ap[0]);
      if (hit && hit.bid === s.bid) todo.push([id, reanchor(ap, s)]);
    });
    if (!todo.length) return;
    todo.forEach(([id]) => migrated.add(id));
    ydoc.transact(() => todo.forEach(([id, r]) => strokes.set(id, r)), "migrate");
  }
  const onImg = () => { layout(); renderAll(); };
  pmEl.addEventListener("pupka-img", onImg);
  pmEl.addEventListener("load", () => { schedule(); setTimeout(migrateLegacy, 400); }, true);
  setTimeout(() => { layout(); migrateLegacy(); }, 1500);
  window.addEventListener("resize", schedule);
  schedule();

  function toLocal(e) {
    const r = pmEl.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }
  function commit(rec) {
    const r = Object.assign(record(rec.p, rec), { by: name, ts: Date.now() });
    const id = uid();
    tx(() => strokes.set(id, r));
    return id;
  }
  function reanchor(absPoints, s) { return record(absPoints, s); }

  function imageEl(bid) { const fig = pmEl.querySelector('.img-figure[data-bid="' + bid + '"]'); return fig && fig.querySelector("img"); }
  async function fillImage(bid, fills, author) {
    layout();
    const im = imgs.get(bid), el = imageEl(bid);
    if (!im || !el || im.w < 20) throw new Error("Nie widzę tego obrazka na karcie.");
    const px = await loadPixels(el.currentSrc || el.src);
    const kx = im.w / px.w, ky = im.h / px.h;
    const recs = [], notes = [];
    for (const f of (Array.isArray(fills) ? fills : []).slice(0, 24)) {
      const sx = (+f.x / 1000) * px.w, sy = (+f.y / 1000) * px.h;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      const res = floodRegion(px, sx, sy, { walls: f.walls, gap: f.gap, tolerance: f.tolerance });
      if (!res.mask) { notes.push("punkt (" + Math.round(f.x) + ", " + Math.round(f.y) + ") leży na linii"); continue; }
      if (res.leak) { notes.push("obszar przy (" + Math.round(f.x) + ", " + Math.round(f.y) + ") wylewa się na cały obrazek, pominięty"); continue; }
      const rings = maskToRings(res.mask, px.w, px.h, 1.1);
      if (!rings.length) continue;
      const flat = [], lens = [];
      for (const r of rings) { lens.push(r.length); for (const q of r) flat.push([Math.round(q[0] * kx * 10) / 10, Math.round(q[1] * ky * 10) / 10]); }
      const color = /^#[0-9a-fA-F]{6}$/.test(String(f.color || "")) ? f.color : st.color;
      const op = Number.isFinite(+f.opacity) && f.opacity !== null ? Math.max(0.15, Math.min(0.9, +f.opacity)) : 0.45;
      recs.push({ t: "area", p: flat, r: lens, f: color, c: color, o: op, w: 1, a: bid, aw: r1(im.w), by: author || name, ts: Date.now() });
    }
    if (recs.length) tx(() => recs.forEach((r) => strokes.set(uid(), r)));
    return { count: recs.length, notes };
  }
  function clusters() {
    layout();
    const items = [];
    strokes.forEach((s, id) => {
      if (s.a || s.t === "mind") return;
      const pts = absPts(s);
      if (!pts.length) return;
      const pad = s.t === "hl" ? (s.w || 4) * 2 : (s.w || 4);
      const bb = s.t === "label" ? { x0: pts[0][0], y0: pts[0][1] - (s.w || 16), x1: pts[0][0] + String(s.txt || "").length * (s.w || 16) * 0.6, y1: pts[0][1] + 4 } : bbox(pts);
      items.push({ id, s, bb: { x0: bb.x0 - pad, y0: bb.y0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad } });
    });
    const parent = items.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const M = 24;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i].bb, b = items[j].bb;
      if (a.x0 - M <= b.x1 && b.x0 - M <= a.x1 && a.y0 - M <= b.y1 && b.y0 - M <= a.y1) parent[find(i)] = find(j);
    }
    const groups = new Map();
    items.forEach((it, i) => {
      const k = find(i);
      if (!groups.has(k)) groups.set(k, { ids: [], bb: Object.assign({}, it.bb), by: new Set(), top: it });
      const g = groups.get(k);
      g.ids.push(it.id); g.by.add(it.s.by || "?");
      g.bb.x0 = Math.min(g.bb.x0, it.bb.x0); g.bb.y0 = Math.min(g.bb.y0, it.bb.y0); g.bb.x1 = Math.max(g.bb.x1, it.bb.x1); g.bb.y1 = Math.max(g.bb.y1, it.bb.y1);
      if (it.bb.y0 < g.top.bb.y0) g.top = it;
    });
    return Array.from(groups.values()).filter((g) => g.ids.length >= 2 || (g.bb.x1 - g.bb.x0) * (g.bb.y1 - g.bb.y0) > 3600).sort((a, b) => a.bb.y0 - b.bb.y0 || a.bb.x0 - b.bb.x0).map((g, i) => Object.assign(g, { n: i + 1 }));
  }
  async function rasterCluster(c) {
    const P = 18;
    const x0 = c.bb.x0 - P, y0 = c.bb.y0 - P, w = c.bb.x1 - c.bb.x0 + 2 * P, h = c.bb.y1 - c.bb.y0 + 2 * P;
    const k = Math.min(2, 900 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const sv = svg("svg", { xmlns: NS, width: W, height: H, viewBox: x0 + " " + y0 + " " + w + " " + h });
    for (const id of c.ids) {
      const s = strokes.get(id), f = s && frame(s);
      if (!f) continue;
      const g = build(id, s);
      g.setAttribute("transform", "translate(" + f.ox + "," + f.oy + ")" + (f.k !== 1 ? " scale(" + f.k + ")" : ""));
      sv.appendChild(g);
    }
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(sv)], { type: "image/svg+xml" }));
    await new Promise((res) => { const i = new Image(); i.onload = () => { g.drawImage(i, 0, 0, W, H); res(); }; i.onerror = res; i.src = url; });
    URL.revokeObjectURL(url);
    return { cv, g, W, H, x0, y0, k };
  }
  async function fillCluster(c, fills, author, defOpacity) {
    const r = await rasterCluster(c);
    const px = { w: r.W, h: r.H, data: r.g.getImageData(0, 0, r.W, r.H).data };
    const recs = [], notes = [];
    for (const f of (Array.isArray(fills) ? fills : []).slice(0, 24)) {
      const sx = (+f.x / 1000) * r.W, sy = (+f.y / 1000) * r.H;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      const gap = Number.isFinite(+f.gap) && f.gap !== null ? +f.gap : 4;
      const res = floodRegion(px, sx, sy, { gap: Math.round(gap * r.k), tolerance: 70, clipOutside: false });
      const where = "(" + Math.round(f.x) + ", " + Math.round(f.y) + ")";
      if (!res.mask) { notes.push("punkt " + where + " leży na kresce"); continue; }
      let open = false;
      for (let x = 0; x < r.W && !open; x++) if (res.mask[x] || res.mask[(r.H - 1) * r.W + x]) open = true;
      for (let y = 0; y < r.H && !open; y++) if (res.mask[y * r.W] || res.mask[y * r.W + r.W - 1]) open = true;
      if (open) { notes.push("obszar przy " + where + " nie jest zamknięty kreskami"); continue; }
      const rings = maskToRings(res.mask, r.W, r.H, 1.1);
      if (!rings.length) continue;
      const abs = [], lens = [];
      for (const ring of rings) { lens.push(ring.length); for (const q of ring) abs.push([r.x0 + q[0] / r.k, r.y0 + q[1] / r.k]); }
      const color = /^#[0-9a-fA-F]{6}$/.test(String(f.color || "")) ? f.color : st.color;
      const op = Number.isFinite(+f.opacity) && f.opacity !== null ? Math.max(0.15, Math.min(1, +f.opacity)) : defOpacity;
      recs.push(Object.assign(record(abs, { t: "area", r: lens, f: color, c: color, o: op, w: 1 }), { by: author || name, ts: Date.now() }));
    }
    if (recs.length) tx(() => recs.forEach((rec) => strokes.set(uid(), rec)));
    return { count: recs.length, notes };
  }
  async function fillDrawing(n, fills, author) {
    const c = clusters()[(n | 0) - 1];
    if (!c) throw new Error("Nie ma rysunku R" + n + " na tej karcie.");
    return fillCluster(c, fills, author, 0.8);
  }
  function paintGrid(g, W, H) {
    g.lineWidth = 1; g.font = "bold 11px sans-serif"; g.textBaseline = "top";
    for (let v = 100; v < 1000; v += 100) {
      const x = Math.round(v / 1000 * W) + 0.5, y = Math.round(v / 1000 * H) + 0.5;
      g.strokeStyle = v === 500 ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.22)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      for (const [tx, ty] of [[x + 2, 2], [2, y + 2]]) { g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(tx - 1, ty - 1, 24, 13); g.fillStyle = "#000"; g.fillText(String(v), tx, ty); }
    }
  }
  let filling = false;
  async function fillAtPoint(p) {
    if (filling) return;
    const hitImg = imageAt(p);
    const hint = (t) => onChange && onChange(Object.assign(api.getState(), { hint: t }));
    const c = hitImg ? null : clusters().find((g) => p[0] >= g.bb.x0 && p[0] <= g.bb.x1 && p[1] >= g.bb.y0 && p[1] <= g.bb.y1);
    if (!hitImg && !c) { hint("Kliknij wiadrem w zamknięty obszar rysunku albo obrazka."); return; }
    filling = true; layer.classList.add("busy");
    try {
      let res;
      if (hitImg) {
        const r = hitImg.r;
        res = await fillImage(hitImg.bid, [{ x: (p[0] - r.left) / r.w * 1000, y: (p[1] - r.top) / r.h * 1000, color: st.color }], name);
      } else {
        const P = 18, x0 = c.bb.x0 - P, y0 = c.bb.y0 - P, w = c.bb.x1 - c.bb.x0 + 2 * P, h = c.bb.y1 - c.bb.y0 + 2 * P;
        res = await fillCluster(c, [{ x: (p[0] - x0) / w * 1000, y: (p[1] - y0) / h * 1000, color: st.color }], name, 0.8);
      }
      if (!res.count) hint(res.notes[0] ? "Nie wypełniłem: " + res.notes[0] + "." : "Nie znalazłem obszaru do wypełnienia.");
    } catch (e) { hint(e.message); }
    finally { filling = false; layer.classList.remove("busy"); }
  }

  function printCleanup() {
    (pmEl.parentElement || pageEl).querySelectorAll(":scope > .print-copy").forEach((n) => n.remove());
  }

  let liveEl = null;
  let draftTimer = 0;
  function broadcastDraft(d, force) {
    if (!provider) return;
    const now = performance.now();
    if (d && !force && now - draftTimer < 90) return;
    draftTimer = now;
    provider.awareness.setLocalStateField("draft", d ? { t: d.t, c: d.c, w: d.w, txt: d.txt, p: d.p.filter((_, i) => i % 2 === 0 || i === d.p.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]) } : null);
  }
  function previewOf(d) {
    const g = build("live", d);
    g.setAttribute("transform", "translate(0,0)");
    return g;
  }
  function updateLive(d) {
    if (liveEl) liveEl.remove();
    liveEl = d ? previewOf(d) : null;
    if (liveEl) svgLive.appendChild(liveEl);
  }

  const remote = new Map();
  function renderRemote() {
    if (!provider) return;
    const seen = new Set();
    provider.awareness.getStates().forEach((s, cid) => {
      if (cid === ydoc.clientID) return;
      seen.add(cid);
      let r = remote.get(cid);
      if (!r) { r = { g: svg("g", { class: "remote" }), dot: svg("g", { class: "remote-dot" }) }; svgLive.append(r.g, r.dot); remote.set(cid, r); }
      r.g.innerHTML = "";
      r.dot.innerHTML = "";
      if (s.draft && s.draft.p && s.draft.p.length) {
        r.g.appendChild(previewOf(s.draft));
        const [x, y] = s.draft.p[s.draft.p.length - 1];
        const c = (s.user && s.user.color) || s.draft.c;
        r.dot.appendChild(svg("circle", { cx: x, cy: y, r: 5, fill: c }));
        const t = svg("text", { x: x + 9, y: y - 8, fill: c, "font-size": 11, class: "remote-name" });
        t.textContent = (s.user && s.user.name) || "";
        r.dot.appendChild(t);
      }
    });
    for (const [cid, r] of remote) if (!seen.has(cid)) { r.g.remove(); r.dot.remove(); remote.delete(cid); }
  }
  if (provider) provider.awareness.on("change", renderRemote);

  let selBox = null;
  function selectionBounds() {
    if (!st.selection.size) return null;
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const id of st.selection) {
      const s = strokes.get(id);
      if (!s) continue;
      const pts = absPts(s);
      if (!pts.length) continue;
      const bb = s.t === "label" ? { x0: pts[0][0], y0: pts[0][1] - (s.w || 16), x1: pts[0][0] + String(s.txt || "").length * (s.w || 16) * 0.55, y1: pts[0][1] + 4 } : bbox(pts);
      const pad = s.t === "hl" ? (s.w || 4) * 2 : (s.w || 4);
      b = { x0: Math.min(b.x0, bb.x0 - pad), y0: Math.min(b.y0, bb.y0 - pad), x1: Math.max(b.x1, bb.x1 + pad), y1: Math.max(b.y1, bb.y1 + pad) };
    }
    return b.x0 === Infinity ? null : b;
  }
  function drawSelection() {
    if (selBox) { selBox.remove(); selBox = null; }
    for (const id of Array.from(st.selection)) if (!strokes.has(id)) st.selection.delete(id);
    const b = selectionBounds();
    if (!b) return;
    selBox = svg("rect", { x: b.x0 - 4, y: b.y0 - 4, width: b.x1 - b.x0 + 8, height: b.y1 - b.y0 + 8, class: "sel-box" });
    svgLive.appendChild(selBox);
  }
  function clearSelection() { st.selection.clear(); drawSelection(); }
  function deleteSelection() {
    if (!st.selection.size) return;
    tx(() => { for (const id of st.selection) strokes.delete(id); });
    clearSelection();
  }
  function copySelection() {
    if (!st.selection.size) return;
    st.clipboard = Array.from(st.selection).map((id) => { const s = strokes.get(id); return s ? Object.assign({}, s, { p: absPts(s) }) : null; }).filter((x) => x && x.p.length);
  }
  function paste() {
    if (!st.clipboard || !st.clipboard.length) return;
    const ids = [];
    tx(() => {
      for (const s of st.clipboard) {
        const moved = s.p.map(([x, y]) => [x + 24, y + 24]);
        const id = uid();
        strokes.set(id, Object.assign(reanchor(moved, s), { by: name, ts: Date.now() }));
        ids.push(id);
      }
    });
    st.clipboard = st.clipboard.map((s) => Object.assign({}, s, { p: s.p.map(([x, y]) => [x + 24, y + 24]) }));
    st.selection = new Set(ids);
    drawSelection();
  }
  function moveSelection(dx, dy) {
    tx(() => {
      for (const id of st.selection) {
        const s = strokes.get(id);
        if (!s) continue;
        const ap = absPts(s);
        if (!ap.length) continue;
        strokes.set(id, reanchor(ap.map(([x, y]) => [x + dx, y + dy]), s));
      }
    });
  }

  function eraseAt(p) {
    const hit = [];
    strokes.forEach((s, id) => {
      if (s.t === "mind") return;
      const pts = absPts(s);
      if (!pts.length) return;
      if (s.t === "area") {
        let o = 0, inside = false;
        for (const n of (s.r && s.r.length ? s.r : [pts.length])) { if (inPoly(p, pts.slice(o, o + n))) inside = !inside; o += n; }
        if (inside) hit.push(id);
        return;
      }
      const bb = s.t === "label" ? { x0: pts[0][0], y0: pts[0][1] - 16, x1: pts[0][0] + String(s.txt || "").length * 9, y1: pts[0][1] + 4 } : bbox(pts);
      const r = ERASE_R + (s.w || 4);
      if (p[0] < bb.x0 - r || p[0] > bb.x1 + r || p[1] < bb.y0 - r || p[1] > bb.y1 + r) return;
      if (s.t === "label") { hit.push(id); return; }
      if (s.t === "rect") {
        const [a, b] = pts;
        const corners = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
        for (let i = 1; i < corners.length; i++) if (segDist(p, corners[i - 1], corners[i]) < r) { hit.push(id); return; }
        return;
      }
      if (s.t === "ellipse") {
        const [a, b] = pts;
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 || 1, ry = Math.abs(b[1] - a[1]) / 2 || 1;
        const v = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry);
        if (Math.abs(v - 1) * Math.min(rx, ry) < r) hit.push(id);
        return;
      }
      for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) < r) { hit.push(id); return; }
      if (pts.length === 1 && dist(p, pts[0]) < r) hit.push(id);
    });
    if (!hit.length) return;
    const cut = new Map();
    const gone = [];
    for (const id of hit) {
      const parts = st.eraseMode === "part" ? splitAt(strokes.get(id), p) : null;
      if (parts === false) continue;
      if (parts) cut.set(id, parts);
      gone.push(id);
    }
    if (gone.length) ydoc.transact(() => gone.forEach((id) => {
      const parts = cut.get(id);
      strokes.delete(id);
      if (parts) for (const r of parts) strokes.set(uid(), r);
    }), "draw");
  }
  function splitAt(s, p) {
    if (!["pen", "hl", "line", "arrow"].includes(s.t) && !(s.t === "poly" && !s.closed)) return null;
    const f = frame(s);
    if (!f) return null;
    const lp = [(p[0] - f.ox) / f.k, (p[1] - f.oy) / f.k];
    const rl = (ERASE_R + (s.t === "hl" ? (s.w || 4) * 2 : (s.w || 4) / 2)) / f.k;
    const dense = [];
    for (let i = 0; i < s.p.length; i++) {
      if (i) { const a = s.p[i - 1], b = s.p[i], n = Math.floor(dist(a, b) / 1.5); for (let j = 1; j < n; j++) dense.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); }
      dense.push(s.p[i]);
    }
    const runs = [];
    let cur = [];
    for (const q of dense) { if (dist(q, lp) < rl) { if (cur.length) runs.push(cur); cur = []; } else cur.push(q); }
    if (cur.length) runs.push(cur);
    if (runs.length === 1 && runs[0].length === dense.length) return false;
    const now = Date.now();
    return runs.filter((r) => r.length > 1 && pathLength(r) > 2).map((r, i, all) => {
      const pts = r.map(([x, y]) => [r1(x), r1(y)]);
      if (s.t === "line" || s.t === "arrow") return Object.assign({}, s, { t: s.t === "arrow" && r[r.length - 1] === dense[dense.length - 1] ? "arrow" : "line", p: [pts[0], pts[pts.length - 1]], ts: now });
      return Object.assign({}, s, { p: pts.length > 3 ? rdp(pts, 0.35) : pts, ts: now });
    });
  }

  let labelInput = null;
  function openLabel(p, existingId) {
    closeLabel(false);
    const s = existingId ? strokes.get(existingId) : null;
    const box = document.createElement("div");
    box.className = "draw-label-input";
    box.contentEditable = "true";
    box.style.left = p[0] + "px";
    box.style.top = (p[1] - (s ? (s.w || 16) : 16)) + "px";
    box.style.color = s ? s.c : st.color;
    box.style.fontSize = (s ? (s.w || 16) : 16) + "px";
    box.textContent = s ? s.txt : "";
    layer.appendChild(box);
    labelInput = { box, p, existingId };
    const sendDraft = () => { const t = box.innerText.replace(/\n+$/, ""); broadcastDraft(t ? { t: "label", c: s ? s.c : st.color, w: s ? (s.w || 16) : 16, p: [p], txt: t } : null, true); };
    box.addEventListener("input", sendDraft);
    box.focus();
    if (s) { const r = document.createRange(); r.selectNodeContents(box); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closeLabel(true); }
      else if (e.key === "Escape") { e.preventDefault(); closeLabel(false); }
      e.stopPropagation();
    });
    box.addEventListener("blur", () => setTimeout(() => closeLabel(true), 50));
  }
  function closeLabel(commitIt) {
    if (!labelInput) return;
    const { box, p, existingId } = labelInput;
    labelInput = null;
    const txt = box.innerText.replace(/\n+$/, "").trim();
    box.remove();
    broadcastDraft(null, true);
    if (!commitIt) return;
    if (existingId) {
      const s = strokes.get(existingId);
      if (!s) return;
      tx(() => { if (txt) strokes.set(existingId, Object.assign({}, s, { txt })); else strokes.delete(existingId); });
    } else if (txt) commit({ t: "label", c: st.color, w: 16, p: [p], txt });
  }
  function labelAt(p) {
    let found = null;
    strokes.forEach((s, id) => {
      if (s.t !== "label") return;
      const ap = absPts(s);
      if (!ap.length) return;
      const [x, y] = ap[0];
      const w = String(s.txt || "").split("\n").reduce((m, l) => Math.max(m, l.length), 0) * (s.w || 16) * 0.6;
      const h = (s.w || 16) * 1.3 * String(s.txt || "").split("\n").length;
      if (p[0] >= x - 4 && p[0] <= x + w + 4 && p[1] >= y - (s.w || 16) && p[1] <= y - (s.w || 16) + h + 4) found = id;
    });
    return found;
  }

  function down(e) {
    if (!st.active || !canEdit()) return;
    if (e.button !== 0 || st.spaceDown) return;
    if (labelInput) { closeLabel(true); return; }
    const p = toLocal(e);
    try { capture.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
    const tool = st.tool;
    if (tool === "label") {
      const ex = labelAt(p);
      openLabel(ex ? absPts(strokes.get(ex))[0] : p, ex);
      return;
    }
    if (tool === "fill") { fillAtPoint(p); return; }
    if (tool === "eraser") { undo.stopCapturing(); st.drawing = { tool, last: p }; eraseAt(p); return; }
    if (tool === "lasso") {
      const b = selectionBounds();
      if (b && p[0] >= b.x0 - 6 && p[0] <= b.x1 + 6 && p[1] >= b.y0 - 6 && p[1] <= b.y1 + 6) { st.drawing = { tool: "move", start: p, last: p, dx: 0, dy: 0 }; return; }
      const ex = labelAt(p);
      if (ex && e.detail >= 2) { openLabel(absPts(strokes.get(ex))[0], ex); return; }
      clearSelection();
      st.drawing = { tool, pts: [p] };
      return;
    }
    const shape = tool === "pen" && e.shiftKey ? "line" : tool;
    st.drawing = { tool: shape, pts: [p], start: p, c: st.color, w: st.size };
    updateLive(previewRec(st.drawing));
  }
  function previewRec(d) {
    if (d.tool === "pen" || d.tool === "hl") return { t: d.tool, c: d.c, w: d.w, p: d.pts };
    if (d.tool === "lasso") return { t: "hl", c: "#2f7cf6", w: 0.5, p: d.pts };
    return { t: d.tool, c: d.c, w: d.w, p: [d.start, d.pts[d.pts.length - 1]] };
  }
  function move(e) {
    const d = st.drawing;
    if (!d) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!evs || !evs.length) evs = [e];
    if (d.tool === "eraser") { for (const ev of evs) eraseAt(toLocal(ev)); return; }
    if (d.tool === "move") {
      const p = toLocal(e);
      const dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      d.last = p; d.dx += dx; d.dy += dy;
      for (const id of st.selection) { const el = els.get(id); const f = el && frame(el.s); if (f) el.g.setAttribute("transform", `translate(${r1(f.ox + d.dx)},${r1(f.oy + d.dy)})${f.k !== 1 ? ` scale(${f.k})` : ""}`); }
      if (selBox) selBox.setAttribute("transform", `translate(${d.dx},${d.dy})`);
      return;
    }
    for (const ev of evs) {
      const p = toLocal(ev);
      const last = d.pts[d.pts.length - 1];
      if (d.tool === "pen" || d.tool === "hl" || d.tool === "lasso") { if (dist(p, last) >= 1.2) d.pts.push(p); }
      else d.pts.push(p);
    }
    if (d.tool !== "lasso" && d.pts.length > 400 && (d.tool === "pen" || d.tool === "hl")) d.pts = rdp(d.pts, 0.35);
    const rec = previewRec(d);
    updateLive(rec);
    if (d.tool !== "lasso") broadcastDraft(rec);
  }
  function up(e) {
    const d = st.drawing;
    if (!d) return;
    st.drawing = null;
    if (d.tool === "eraser") { undo.stopCapturing(); return; }
    if (d.tool === "move") {
      if (Math.abs(d.dx) > 0.5 || Math.abs(d.dy) > 0.5) moveSelection(d.dx, d.dy);
      else for (const id of st.selection) place(id);
      if (selBox) selBox.removeAttribute("transform");
      drawSelection();
      return;
    }
    updateLive(null);
    broadcastDraft(null);
    if (d.tool === "lasso") {
      if (d.pts.length < 4) return;
      const poly = d.pts;
      strokes.forEach((s, id) => {
        if (s.t === "mind") return;
        const pts = absPts(s);
        if (!pts.length) return;
        let test = pts;
        if (s.t === "rect" || s.t === "ellipse") { const [a, b] = pts; test = [a, [b[0], a[1]], b, [a[0], b[1]], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]; }
        const inside = test.filter((p) => inPoly(p, poly)).length;
        if (inside / test.length >= 0.5) st.selection.add(id);
      });
      drawSelection();
      return;
    }
    if (d.tool === "pen" || d.tool === "hl") {
      if (d.pts.length === 1) d.pts.push([d.pts[0][0] + 0.5, d.pts[0][1] + 0.5]);
      commit({ t: d.tool, c: d.c, w: d.w, p: d.pts });
      return;
    }
    const end = d.pts[d.pts.length - 1];
    if (dist(d.start, end) < 3) return;
    let b = end;
    if (d.tool === "line" || d.tool === "arrow") {
      const deg = (Math.atan2(b[1] - d.start[1], b[0] - d.start[0]) * 180) / Math.PI;
      if (Math.abs(deg) < 5 || Math.abs(Math.abs(deg) - 180) < 5) b = [b[0], d.start[1]];
      else if (Math.abs(Math.abs(deg) - 90) < 5) b = [d.start[0], b[1]];
    }
    if (e.shiftKey && (d.tool === "rect" || d.tool === "ellipse")) {
      const side = Math.max(Math.abs(b[0] - d.start[0]), Math.abs(b[1] - d.start[1]));
      b = [d.start[0] + Math.sign(b[0] - d.start[0] || 1) * side, d.start[1] + Math.sign(b[1] - d.start[1] || 1) * side];
    }
    commit({ t: d.tool, c: d.c, w: d.w, p: [d.start, b] });
  }
  capture.addEventListener("pointerdown", down);
  capture.addEventListener("pointermove", move);
  capture.addEventListener("pointerup", up);
  capture.addEventListener("pointercancel", up);
  capture.addEventListener("dblclick", (e) => {
    if (!st.active || st.tool !== "lasso") return;
    const p = toLocal(e);
    const ex = labelAt(p);
    if (ex) openLabel(absPts(strokes.get(ex))[0], ex);
  });

  function applyMode() {
    layer.classList.toggle("active", st.active);
    capture.dataset.tool = st.tool;
    capture.style.pointerEvents = st.active && !st.spaceDown ? "auto" : "none";
    if (!st.active) { clearSelection(); closeLabel(true); }
    onChange && onChange(api.getState());
  }

  const api = {
    layer,
    setActive(v) { st.active = !!v; applyMode(); },
    isActive() { return st.active; },
    setTool(t) { st.tool = t; if (t !== "lasso") clearSelection(); applyMode(); },
    setColor(c) { st.color = c; if (st.selection.size) { tx(() => { for (const id of st.selection) { const s = strokes.get(id); if (s) strokes.set(id, Object.assign({}, s, { c })); } }); } onChange && onChange(api.getState()); },
    setSize(w) { st.size = w; onChange && onChange(api.getState()); },
    setSpace(v) { st.spaceDown = v; capture.style.pointerEvents = st.active && !v ? "auto" : "none"; },
    toggleGrid() { st.grid = !st.grid; localStorage.setItem("pupka-grid", st.grid ? "1" : "0"); pageEl.classList.toggle("grid", st.grid); onChange && onChange(api.getState()); },
    setEraseMode(m) { st.eraseMode = m === "stroke" ? "stroke" : "part"; try { localStorage.setItem("pupka-erase", st.eraseMode); } catch (e) { /* storage blocked */ } st.tool = "eraser"; clearSelection(); applyMode(); },
    getState() { return { active: st.active, tool: st.tool, color: st.color, size: st.size, grid: st.grid, selection: st.selection.size, eraseMode: st.eraseMode }; },
    undo() { undo.undo(); },
    redo() { undo.redo(); },
    canUndo() { return undo.canUndo(); },
    deleteSelection, copySelection, paste, clearSelection,
    hasSelection() { return st.selection.size > 0; },
    selectAll() { st.selection = new Set(Array.from(strokes.entries()).filter(([, x]) => x.t !== "mind").map(([id]) => id)); drawSelection(); },
    count() { return strokes.size; },
    fillImage,
    imageSig(bid) { let n = 0, t = 0; strokes.forEach((s) => { if (s.a === bid) { n++; t = Math.max(t, s.ts || 0); } }); const im = imgs.get(bid); return n + ":" + t + ":" + (im ? Math.round(im.w) : 0); },
    async imageSnapshot(bid) {
      layout();
      const im = imgs.get(bid), el = imageEl(bid);
      if (!im || !el) return null;
      const src = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("obrazek")); i.src = el.currentSrc || el.src; });
      const W = Math.min(1000, src.naturalWidth || im.w), H = Math.round(W * (src.naturalHeight || im.h) / (src.naturalWidth || im.w));
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(src, 0, 0, W, H);
      const sv = svg("svg", { xmlns: NS, width: W, height: H, viewBox: "0 0 " + im.w + " " + im.h });
      strokes.forEach((s, id) => { if (s.a !== bid) return; const gg = build(id, s); const k = s.aw ? im.w / s.aw : 1; if (k !== 1) gg.setAttribute("transform", "scale(" + k + ")"); sv.appendChild(gg); });
      if (sv.childNodes.length) {
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(sv)], { type: "image/svg+xml" }));
        await new Promise((res) => { const i = new Image(); i.onload = () => { g.drawImage(i, 0, 0, W, H); res(); }; i.onerror = res; i.src = url; });
        URL.revokeObjectURL(url);
      }
      paintGrid(g, W, H);
      return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
    },
    fillDrawing,
    drawings(blockOf) {
      return clusters().map((c) => {
        const kinds = {};
        for (const id of c.ids) { const s = strokes.get(id); const k = s.t === "area" ? "wypełnień" : s.t === "label" ? "napisów" : "kresek"; kinds[k] = (kinds[k] || 0) + 1; }
        const n = c.top.s.bid ? blockOf(c.top.s.bid) : 0;
        return { n: c.n, sig: c.ids.length + ":" + Math.round(c.bb.x1 - c.bb.x0) + "x" + Math.round(c.bb.y1 - c.bb.y0) + ":" + c.ids.map((id) => strokes.get(id).ts || 0).reduce((a, b) => Math.max(a, b), 0), desc: Object.entries(kinds).map(([k, v]) => v + " " + k).join(", ") + " (autor: " + Array.from(c.by).join(", ") + ")" + (n ? ", przy bloku [" + n + "]" : "") + ", około " + Math.round(c.bb.x1 - c.bb.x0) + "×" + Math.round(c.bb.y1 - c.bb.y0) + " px" };
      });
    },
    async drawingSnapshot(n) {
      const c = clusters()[(n | 0) - 1];
      if (!c) return null;
      const r = await rasterCluster(c);
      paintGrid(r.g, r.W, r.H);
      return await new Promise((res) => r.cv.toBlob(res, "image/jpeg", 0.86));
    },
    addImageShapes(bid, shapes, author) {
      layout();
      const im = imgs.get(bid);
      if (!im || im.w < 20) return 0;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));
      const hex = (c, d) => /^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? c : d;
      const conv = (q) => [r1(clamp(q[0], -50, 1050) / 1000 * im.w), r1(clamp(q[1], -50, 1050) / 1000 * im.h)];
      const recs = [];
      for (const sh of Array.isArray(shapes) ? shapes.slice(0, 200) : []) {
        const pts = (Array.isArray(sh.points) ? sh.points : []).slice(0, 400).filter((q) => Array.isArray(q) && q.length >= 2).map(conv);
        if (!pts.length) continue;
        const base = { c: hex(sh.color, "#e03131"), w: clamp(sh.width || 3, 1, 10), by: author || "AI", ts: Date.now(), a: bid, aw: r1(im.w) };
        const f = sh.fill ? hex(sh.fill, null) : null;
        const type = String(sh.type || "");
        if (type === "line" || type === "arrow") { if (pts.length >= 2) recs.push(Object.assign(base, { t: type, p: [pts[0], pts[pts.length - 1]] })); }
        else if (type === "rect" || type === "ellipse") { if (pts.length >= 2) recs.push(Object.assign(base, { t: type, p: [pts[0], pts[pts.length - 1]], f })); }
        else if (type === "curve") { if (pts.length >= 2) recs.push(Object.assign(base, { t: "pen", p: smoothCurve(pts) })); }
        else if (type === "polygon" || type === "polyline") { if (pts.length >= 2) recs.push(Object.assign(base, { t: "poly", p: pts, closed: type === "polygon", f })); }
        else if (type === "label") { const txt = String(sh.text || "").slice(0, 90); if (txt) recs.push(Object.assign(base, { t: "label", p: [pts[0]], txt, w: clamp(sh.size || 15, 9, 32) })); }
        else if (type === "box_text" && pts.length >= 2) {
          const txt = String(sh.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
          if (!txt) continue;
          const x0 = Math.min(pts[0][0], pts[1][0]), x1 = Math.max(pts[0][0], pts[1][0]), y0 = Math.min(pts[0][1], pts[1][1]), y1 = Math.max(pts[0][1], pts[1][1]);
          const bw = Math.max(20, x1 - x0 - 12), bh = Math.max(12, y1 - y0 - 8);
          const meas = document.createElement("canvas").getContext("2d");
          const widthOf = (t, fs) => { meas.font = fs + "px " + ((getComputedStyle(pageEl).getPropertyValue("--doc-font") || "").trim() || "Newsreader") + ", serif"; return meas.measureText(t).width; };
          let size = clamp(sh.size || 16, 9, 28), lines = [txt];
          for (; size >= 9; size--) {
            const words = txt.split(" "), out = [];
            let line = "";
            for (const w of words) { const t = line ? line + " " + w : w; if (widthOf(t, size) <= bw || !line) line = t; else { out.push(line); line = w; } }
            if (line) out.push(line);
            if (out.every((l) => widthOf(l, size) <= bw) && out.length * size * 1.25 <= bh) { lines = out; break; }
            lines = out;
          }
          const lh = size * 1.25, textH = lines.length * lh;
          const widest = Math.max(...lines.map((l) => widthOf(l, size)));
          const x = r1(x0 + Math.max(6, (x1 - x0 - widest) / 2)), y = r1(y0 + (y1 - y0 - textH) / 2 + size * 0.95);
          recs.push(Object.assign(base, { t: "label", p: [[x, y]], txt: lines.join("\n"), w: size, c: hex(sh.color, "#1f1f1f") }));
        }
      }
      if (recs.length) tx(() => recs.forEach((r) => strokes.set(uid(), r)));
      return recs.length;
    },
    imageSummary(blockOf) {
      layout();
      const per = new Map();
      strokes.forEach((s) => {
        if (!s.a) return;
        const im = imgs.get(s.a);
        if (!im || !s.p.length) return;
        const k = s.aw ? im.w / s.aw : 1;
        const xs = s.p.map((q) => q[0] * k / im.w * 1000), ys = s.p.map((q) => q[1] * k / im.h * 1000);
        if (!per.has(s.a)) per.set(s.a, []);
        const kind = s.t === "area" ? "wypełnienie" : s.t === "label" ? 'napis "' + String(s.txt || "").slice(0, 30) + '"' : "kreska";
        per.get(s.a).push(kind + " " + (s.f || s.c || "") + " x " + Math.round(Math.min(...xs)) + "-" + Math.round(Math.max(...xs)) + ", y " + Math.round(Math.min(...ys)) + "-" + Math.round(Math.max(...ys)) + " (" + (s.by || "?") + ")");
      });
      const out = [];
      per.forEach((list, bid) => { const n = blockOf(bid); if (n) out.push("Na obrazku w bloku [" + n + "] jest " + list.length + " rysunków: " + list.slice(0, 25).join("; ")); });
      return out.join("\n");
    },
    clearAll(author, onImage) {
      const ids = [];
      strokes.forEach((s, id) => { if ((!author || s.by === author) && (!onImage || s.a === onImage)) ids.push(id); });
      if (ids.length) tx(() => ids.forEach((id) => strokes.delete(id)));
      clearSelection();
      return ids.length;
    },
    mindAt(bid) { let hit = null; strokes.forEach((s, id) => { if (!hit && s.t === "mind" && s.bid === bid) hit = { id, s }; }); return hit; },
    contentWidth() { layout(); return pmW; },
    putMind(id, bid, tree, W, H) { ydoc.transact(() => strokes.set(id || uid(), { t: "mind", tree, W, H, bid, fy: 0, sp: 1, p: [[0, 0], [W, H]], c: "#2a2724", w: 2, by: name, ts: Date.now() }), "draw"); },
    removeStroke(id) { ydoc.transact(() => strokes.delete(id), "draw"); },
    summary() {
      if (!strokes.size) return "";
      const by = {}, labels = [];
      strokes.forEach((s) => { by[s.by || "?"] = (by[s.by || "?"] || 0) + 1; if (s.t === "label" && s.txt) labels.push(String(s.txt).slice(0, 40)); if (s.t === "mind" && s.tree) labels.push("mapa myśli: " + String(s.tree.t).slice(0, 40)); });
      return `${strokes.size} elementów (${Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(", ")})` + (labels.length ? `; etykiety: ${labels.slice(0, 15).join(" | ")}` : "");
    },
    addShapes(bid, shapes, opts = {}) {
      const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));
      const hex = (c, d) => /^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? c : d;
      const maxY = opts.height || 700;
      const recs = [];
      for (const sh of Array.isArray(shapes) ? shapes.slice(0, 160) : []) {
        const pts = (Array.isArray(sh.points) ? sh.points : []).slice(0, 300).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Math.round(clamp(p[0], 0, 660) * 10) / 10, Math.round(clamp(p[1], 0, maxY) * 10) / 10]);
        if (!pts.length) continue;
        const base = { c: hex(sh.color, "#111111"), w: clamp(sh.width || 2, 1, 8), by: "AI", ts: Date.now(), bid, sp: 1, fy: 0 };
        const f = sh.fill ? hex(sh.fill, null) : null;
        const first = pts[0], last = pts[pts.length - 1];
        const type = String(sh.type || "");
        if (type === "line" || type === "arrow") { if (pts.length >= 2) recs.push(Object.assign(base, { t: type, p: [first, last] })); }
        else if (type === "rect" || type === "ellipse") { if (pts.length >= 2) recs.push(Object.assign(base, { t: type, p: [first, last], f })); }
        else if (type === "curve") { if (pts.length >= 2) recs.push(Object.assign(base, { t: "pen", p: smoothCurve(pts) })); }
        else if (type === "polygon" || type === "polyline") { if (pts.length >= 2) recs.push(Object.assign(base, { t: "poly", p: pts, closed: type === "polygon", f })); }
        else if (type === "label") { const txt = String(sh.text || "").slice(0, 90); if (txt) recs.push(Object.assign(base, { t: "label", p: [first], txt, w: clamp(sh.size || 14, 9, 32) })); }
      }
      if (!recs.length) return 0;
      ydoc.transact(() => recs.forEach((r) => strokes.set(uid(), r)), "draw");
      undo.stopCapturing();
      return recs.length;
    },
    rerender: schedule,
    relayout() { layout(); renderAll(); },
    printPrepare() {
      printCleanup();
      layout();
      const copy = pmEl.cloneNode(true);
      copy.classList.add("print-copy");
      copy.removeAttribute("contenteditable");
      copy.setAttribute("aria-hidden", "true");
      pmEl.parentElement.insertBefore(copy, pmEl);
      const hosts = new Map();
      const hostFor = (s) => {
        if (s.a) { const fig = copy.querySelector('.img-figure[data-bid="' + s.a + '"]'); return fig && fig.querySelector(".img-box"); }
        if (s.bid) return copy.querySelector('[data-bid="' + s.bid + '"]');
        return copy;
      };
      strokes.forEach((s, id) => {
        const f = frame(s);
        const host = f && hostFor(s);
        if (!host || (s.sp && !tops.has(s.bid))) return;
        if (!hosts.has(host)) hosts.set(host, []);
        hosts.get(host).push({ id, s, k: s.a ? f.k : 1 });
      });
      hosts.forEach((list, host) => {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        const sv = svg("svg", { class: "print-strokes", width: 1, height: 1 });
        sv.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:4";
        for (const it of list) { const g = build(it.id, it.s); if (it.k !== 1) g.setAttribute("transform", "scale(" + it.k + ")"); sv.appendChild(g); }
        host.appendChild(sv);
      });
    },
    printCleanup,
    destroy() {
      ro.disconnect();
      clearTimeout(migTimer);
      pmEl.removeEventListener("pupka-img", onImg);
      window.removeEventListener("resize", schedule);
      if (provider) { provider.awareness.off("change", renderRemote); provider.awareness.setLocalStateField("draft", null); }
      if (ownUndo) undo.destroy();
      layer.remove();
    }
  };
  applyMode();
  return api;
}
