/* Drawing layer over the editor: strokes live in a Y.Map, anchored to the text block under their first point,
   rendered as SVG groups whose translate follows the block. Pen, highlighter, eraser, lasso, shapes, labels. */

import { Y, getStroke } from "../lib/vendor.js";
import { uid } from "./store.js";

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
  pageEl.appendChild(layer);

  const st = {
    active: false, tool: "pen", color: color || "#111", size: 4,
    grid: localStorage.getItem("pupka-grid") === "1",
    selection: new Set(), clipboard: null, drawing: null, spaceDown: false
  };
  pageEl.classList.toggle("grid", st.grid);
  const els = new Map();
  let tops = new Map();
  let raf = 0;

  function layout() {
    const pr = pageEl.getBoundingClientRect(), r = pmEl.getBoundingClientRect();
    layer.style.left = (r.left - pr.left - pageEl.clientLeft) + "px";
    layer.style.top = (r.top - pr.top - pageEl.clientTop) + "px";
    layer.style.width = r.width + "px";
    layer.style.height = r.height + "px";
    tops = new Map();
    for (const el of pmEl.children) if (el.dataset && el.dataset.bid) tops.set(el.dataset.bid, el.offsetTop);
  }
  function topOf(s) { const t = tops.get(s.bid); return t == null ? (s.fy || 0) : t; }
  function anchorFor(y) {
    let best = null, bestTop = -Infinity;
    for (const [bid, top] of tops) if (top <= y && top > bestTop) { best = bid; bestTop = top; }
    if (best == null) return { bid: null, top: 0 };
    return { bid: best, top: bestTop };
  }
  function absPts(s) { const t = topOf(s); return s.p.map(([x, y]) => [x, y + t]); }

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
    } else if (s.t === "poly") {
      g.appendChild(svg(s.closed ? "polygon" : "polyline", { points: s.p.map((p) => p.join(",")).join(" "), fill: s.f || "none", stroke: s.c, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round" }));
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
    e.g.setAttribute("transform", `translate(0,${topOf(e.s)})`);
    e.g.style.display = e.s.sp && !tops.has(e.s.bid) ? "none" : "";
    e.g.classList.toggle("selected", st.selection.has(id));
  }
  function renderAll() {
    for (const id of Array.from(els.keys())) if (!strokes.has(id)) { els.get(id).g.remove(); els.delete(id); }
    strokes.forEach((s, id) => {
      const e = els.get(id);
      if (!e || e.s !== s) { if (e) e.g.remove(); const g = build(id, s); svgStatic.appendChild(g); els.set(id, { g, s }); }
      place(id);
    });
    drawSelection();
  }
  function schedule() {
    if (raf) return;
    const run = () => { if (!raf) return; raf = 0; layout(); renderAll(); };
    raf = requestAnimationFrame(run);
    setTimeout(() => { if (raf) { cancelAnimationFrame(raf); run(); } }, 120);
  }
  strokes.observe(() => schedule());
  const ro = new ResizeObserver(() => schedule());
  ro.observe(pmEl);
  window.addEventListener("resize", schedule);
  schedule();

  function toLocal(e) {
    const r = pmEl.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }
  function commit(rec) {
    const first = rec.p[0];
    const { bid, top } = anchorFor(first[1]);
    const r = Object.assign({}, rec, { bid, fy: top, p: rec.p.map(([x, y]) => [Math.round(x * 10) / 10, Math.round((y - top) * 10) / 10]), by: name, ts: Date.now() });
    const id = uid();
    tx(() => strokes.set(id, r));
    return id;
  }
  function reanchor(absPoints, s) {
    const { bid, top } = anchorFor(absPoints[0][1]);
    return Object.assign({}, s, { bid, fy: top, p: absPoints.map(([x, y]) => [Math.round(x * 10) / 10, Math.round((y - top) * 10) / 10]) });
  }

  let liveEl = null;
  let draftTimer = 0;
  function broadcastDraft(d) {
    if (!provider) return;
    const now = performance.now();
    if (d && now - draftTimer < 90) return;
    draftTimer = now;
    provider.awareness.setLocalStateField("draft", d ? { t: d.t, c: d.c, w: d.w, p: d.p.filter((_, i) => i % 2 === 0 || i === d.p.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]) } : null);
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
    st.clipboard = Array.from(st.selection).map((id) => { const s = strokes.get(id); return Object.assign({}, s, { p: absPts(s) }); });
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
        strokes.set(id, reanchor(absPts(s).map(([x, y]) => [x + dx, y + dy]), s));
      }
    });
  }

  function eraseAt(p) {
    const hit = [];
    strokes.forEach((s, id) => {
      const pts = absPts(s);
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
    if (hit.length) tx(() => hit.forEach((id) => strokes.delete(id)));
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
      const [x, y] = absPts(s)[0];
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
    if (tool === "eraser") { st.drawing = { tool, last: p }; eraseAt(p); return; }
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
      for (const id of st.selection) { const el = els.get(id); if (el) el.g.setAttribute("transform", `translate(${d.dx},${topOf(el.s) + d.dy})`); }
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
    if (d.tool === "eraser") return;
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
        const pts = absPts(s);
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
    getState() { return { active: st.active, tool: st.tool, color: st.color, size: st.size, grid: st.grid, selection: st.selection.size }; },
    undo() { undo.undo(); },
    redo() { undo.redo(); },
    canUndo() { return undo.canUndo(); },
    deleteSelection, copySelection, paste, clearSelection,
    hasSelection() { return st.selection.size > 0; },
    selectAll() { st.selection = new Set(strokes.keys()); drawSelection(); },
    count() { return strokes.size; },
    clearAll(author) {
      const ids = [];
      strokes.forEach((s, id) => { if (!author || s.by === author) ids.push(id); });
      if (ids.length) tx(() => ids.forEach((id) => strokes.delete(id)));
      clearSelection();
      return ids.length;
    },
    summary() {
      if (!strokes.size) return "";
      const by = {}, labels = [];
      strokes.forEach((s) => { by[s.by || "?"] = (by[s.by || "?"] || 0) + 1; if (s.t === "label" && s.txt) labels.push(String(s.txt).slice(0, 40)); });
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
    destroy() {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (provider) { provider.awareness.off("change", renderRemote); provider.awareness.setLocalStateField("draft", null); }
      if (ownUndo) undo.destroy();
      layer.remove();
    }
  };
  applyMode();
  return api;
}
