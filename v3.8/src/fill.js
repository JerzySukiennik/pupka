/* Region fill on images: flood fill from a seed point up to the lines of the image, gaps in dashed lines are closed, result traced to polygon rings. */

const cache = new Map();

export function loadPixels(url, maxSide = 1000) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      try { resolve({ w, h, data: g.getImageData(0, 0, w, h).data }); } catch (e) { reject(new Error("Tego obrazka nie da się odczytać (obcy serwer).")); }
    };
    img.onerror = () => reject(new Error("Nie udało się wczytać obrazka."));
    img.src = url;
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function dilate(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = -1e9;
    for (let x = 0; x < w; x++) { if (src[y * w + x]) run = x; if (x - run <= r) tmp[y * w + x] = 1; }
    run = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) run = x; if (run - x <= r) tmp[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let run = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) run = y; if (y - run <= r) out[y * w + x] = 1; }
    run = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) run = y; if (run - y <= r) out[y * w + x] = 1; }
  }
  return out;
}

export function floodRegion(px, sx, sy, opts = {}) {
  const { w, h, data } = px;
  const tol = opts.tolerance ?? 60, gap = Math.max(0, Math.min(12, Math.round(opts.gap ?? 3)));
  const walls = (opts.walls || []).map(hexRgb).filter(Boolean);
  sx = Math.max(0, Math.min(w - 1, Math.round(sx))); sy = Math.max(0, Math.min(h - 1, Math.round(sy)));
  const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11;
  const seed = at(sy * w + sx);
  const wall = new Uint8Array(w * h);
  const wallTol = (opts.wallTolerance ?? 70) ** 2, t2 = tol * tol;
  for (let i = 0; i < w * h; i++) {
    const c = at(i);
    if (walls.length) { for (const wc of walls) if (d2(c, wc) < wallTol) { wall[i] = 1; break; } }
    else if (d2(c, seed) > t2) wall[i] = 1;
  }
  const blocked = dilate(wall, w, h, gap);
  let start = sy * w + sx;
  if (blocked[start]) {
    let best = -1, bd = 1e9;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (!blocked[i] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = i; }
    }
    if (best < 0) return { mask: null, area: 0, leak: false };
    start = best;
  }
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0, area = 0;
  stack[sp++] = start; mask[start] = 1;
  while (sp) {
    const i = stack[--sp]; area++;
    const x = i % w, y = (i - x) / w;
    if (x > 0 && !mask[i - 1] && !blocked[i - 1]) { mask[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < w - 1 && !mask[i + 1] && !blocked[i + 1]) { mask[i + 1] = 1; stack[sp++] = i + 1; }
    if (y > 0 && !mask[i - w] && !blocked[i - w]) { mask[i - w] = 1; stack[sp++] = i - w; }
    if (y < h - 1 && !mask[i + w] && !blocked[i + w]) { mask[i + w] = 1; stack[sp++] = i + w; }
  }
  if (gap > 0) {
    const grown = dilate(mask, w, h, gap);
    for (let i = 0; i < w * h; i++) if (grown[i] && !wall[i] && blocked[i]) mask[i] = 1;
  }
  let touches = false;
  for (let x = 0; x < w && !touches; x++) if (mask[x] || mask[(h - 1) * w + x]) touches = true;
  for (let y = 0; y < h && !touches; y++) if (mask[y * w] || mask[y * w + w - 1]) touches = true;
  if (touches && opts.clipOutside !== false) {
    const bg = [255, 255, 255];
    const line = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (d2(at(i), bg) > 40 * 40) line[i] = 1;
    const lineB = dilate(line, w, h, Math.max(gap, 4));
    const outside = new Uint8Array(w * h);
    let osp = 0;
    const push = (i) => { if (!outside[i] && !lineB[i]) { outside[i] = 1; stack[osp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (osp) {
      const i = stack[--osp]; const x = i % w, y = (i - x) / w;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
    }
    const outGrown = dilate(outside, w, h, Math.max(gap, 4));
    let kept = 0;
    const clipped = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (mask[i] && !outGrown[i]) { clipped[i] = 1; kept++; }
    if (kept > area * 0.05 && kept > 200) {
      let seedIdx = clipped[start] ? start : -1;
      if (seedIdx < 0) { let bd = 1e18; for (let i = 0; i < w * h; i++) if (clipped[i]) { const x = i % w, y = (i - x) / w, d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; seedIdx = i; } } }
      const comp = new Uint8Array(w * h);
      let csp = 0, carea = 0;
      comp[seedIdx] = 1; stack[csp++] = seedIdx;
      while (csp) {
        const i = stack[--csp]; carea++;
        const x = i % w, y = (i - x) / w;
        if (x > 0 && clipped[i - 1] && !comp[i - 1]) { comp[i - 1] = 1; stack[csp++] = i - 1; }
        if (x < w - 1 && clipped[i + 1] && !comp[i + 1]) { comp[i + 1] = 1; stack[csp++] = i + 1; }
        if (y > 0 && clipped[i - w] && !comp[i - w]) { comp[i - w] = 1; stack[csp++] = i - w; }
        if (y < h - 1 && clipped[i + w] && !comp[i + w]) { comp[i + w] = 1; stack[csp++] = i + w; }
      }
      return { mask: comp, area: carea, leak: carea > w * h * 0.9 };
    }
  }
  return { mask, area, leak: area > w * h * 0.9 };
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function maskToRings(mask, w, h, eps = 1.2) {
  const W = w + 1;
  const out = new Map();
  const edges = [];
  const add = (x0, y0, x1, y1) => { const k = y0 * W + x0; const e = { x0, y0, x1, y1, used: false }; edges.push(e); if (!out.has(k)) out.set(k, []); out.get(k).push(e); };
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!inside(x, y - 1)) add(x + 1, y, x, y);
    if (!inside(x - 1, y)) add(x, y, x, y + 1);
    if (!inside(x, y + 1)) add(x, y + 1, x + 1, y + 1);
    if (!inside(x + 1, y)) add(x + 1, y + 1, x + 1, y);
  }
  const rings = [];
  for (const e0 of edges) {
    if (e0.used) continue;
    const ring = [];
    let e = e0;
    while (e && !e.used) {
      e.used = true;
      ring.push([e.x0, e.y0]);
      const cand = (out.get(e.y1 * W + e.x1) || []).filter((c) => !c.used);
      if (cand.length <= 1) { e = cand[0]; continue; }
      const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
      e = cand.sort((a, b) => ((a.x1 - a.x0) * dy - (a.y1 - a.y0) * dx) - ((b.x1 - b.x0) * dy - (b.y1 - b.y0) * dx))[0];
    }
    if (ring.length < 8) continue;
    const corners = ring.filter((p, i) => { const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length]; return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
    if (corners.length < 3) continue;
    let far = 0, fd = -1;
    for (let i = 1; i < corners.length; i++) { const d = (corners[i][0] - corners[0][0]) ** 2 + (corners[i][1] - corners[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
    const a = rdp(corners.slice(0, far + 1), eps), b = rdp(corners.slice(far).concat([corners[0]]), eps);
    const simple = a.concat(b.slice(1, -1));
    if (simple.length >= 3) rings.push(simple);
  }
  return rings;
}
