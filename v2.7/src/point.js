/* Pointing for the AI: with the AI chat open, Shift + drag draws a freeform loop on the page; the loop becomes a snapshot the AI can see. */

import { htmlToCanvas } from "../lib/vendor.js";

const NS = "http://www.w3.org/2000/svg";

function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createPointer({ pageEl, pmEl, isActive, onPick, onBusy }) {
  const layer = document.createElementNS(NS, "svg");
  layer.setAttribute("class", "point-layer");
  pageEl.appendChild(layer);
  let poly = null, path = null, pid = null;

  const setReady = (v) => pageEl.classList.toggle("pointing", !!v);
  const onKey = (e) => { if (e.key === "Shift") setReady(e.type === "keydown" && isActive()); };
  const onBlur = () => setReady(false);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  window.addEventListener("blur", onBlur);

  const local = (e) => { const r = pageEl.getBoundingClientRect(); return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)]; };
  const draw = () => { path.setAttribute("d", "M" + poly.map((p) => p.join(",")).join("L") + "Z"); };

  function down(e) {
    if (e.button !== 0 || !e.shiftKey || !isActive()) return;
    e.preventDefault(); e.stopPropagation();
    poly = [local(e)];
    pid = e.pointerId;
    layer.innerHTML = "";
    path = document.createElementNS(NS, "path");
    path.setAttribute("class", "point-path");
    layer.appendChild(path);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }
  function move(e) {
    if (e.pointerId !== pid || !poly) return;
    e.preventDefault();
    const p = local(e), last = poly[poly.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 3) { poly.push(p); draw(); }
  }
  async function up(e) {
    if (e.pointerId !== pid || !poly) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    const pts = poly; poly = null; pid = null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (pts.length < 4 || box.x1 - box.x0 < 14 || box.y1 - box.y0 < 14) { layer.innerHTML = ""; return; }
    onBusy && onBusy(true);
    try {
      const shot = await snapshot(pts, box);
      onPick(Object.assign(shot, { blocks: blocksIn(pts, box) }));
    } catch (err) {
      console.warn("pointer snapshot failed", err);
      onPick(null, err);
    } finally {
      layer.innerHTML = "";
      onBusy && onBusy(false);
    }
  }

  function blocksIn(pts, box) {
    const pr = pageEl.getBoundingClientRect();
    const out = [];
    Array.from(pmEl.children).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const b = { x0: r.left - pr.left, y0: r.top - pr.top, x1: r.right - pr.left, y1: r.bottom - pr.top };
      if (b.x1 < box.x0 || b.x0 > box.x1 || b.y1 < box.y0 || b.y0 > box.y1) return;
      const samples = [];
      for (let sx = 1; sx <= 7; sx++) for (let sy = 1; sy <= 3; sy++) samples.push([b.x0 + (b.x1 - b.x0) * sx / 8, b.y0 + (b.y1 - b.y0) * sy / 4]);
      const covered = samples.filter((s) => inPoly(s, pts)).length / samples.length;
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const centreInside = cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
      if (covered >= 0.3 || centreInside) out.push(i + 1);
    });
    return out;
  }

  async function snapshot(pts, box) {
    const pad = 18;
    const x = Math.max(0, box.x0 - pad), y = Math.max(0, box.y0 - pad);
    const w = Math.min(pageEl.offsetWidth - x, box.x1 - box.x0 + pad * 2), h = Math.min(pageEl.offsetHeight - y, box.y1 - box.y0 + pad * 2);
    const skip = ["point-layer", "img-bar", "img-handle", "draw-capture", "live", "print-copy", "page-breaks", "collaboration-cursor__caret", "collaboration-cursor__label", "draw-label-input"];
    const canvas = await htmlToCanvas(pageEl, {
      width: w, height: h, pixelRatio: 1, backgroundColor: "#ffffff", skipFonts: true, cacheBust: false,
      imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "top left", boxShadow: "none", margin: "0" },
      filter: (n) => !(n.classList && skip.some((c) => n.classList.contains(c)))
    });
    const scale = Math.min(1, 1100 / Math.max(w, h));
    const out = document.createElement("canvas");
    out.width = Math.round(w * scale); out.height = Math.round(h * scale);
    const g = out.getContext("2d");
    g.drawImage(canvas, 0, 0, out.width, out.height);
    g.save();
    g.scale(scale, scale);
    g.translate(-x, -y);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.save();
    g.beginPath(); g.rect(x, y, w, h);
    pts.slice().reverse().forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fill("evenodd");
    g.restore();
    g.lineWidth = 3 / scale; g.strokeStyle = "#a855f7"; g.setLineDash([10 / scale, 6 / scale]);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath(); g.stroke();
    g.restore();
    const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.86));
    return { blob, thumb: URL.createObjectURL(blob) };
  }

  pageEl.addEventListener("pointerdown", down, true);
  return {
    destroy() {
      pageEl.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      layer.remove();
    }
  };
}
