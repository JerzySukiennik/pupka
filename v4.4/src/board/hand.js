/* Hand-drawn geometry: seeded wobble for lines, ellipses, arcs and curves, and smooth SVG paths through the points. */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

export function polyLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

export function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function segments(pts, first) {
  let d = first ? `M${f(pts[0][0])} ${f(pts[0][1])}` : "";
  if (pts.length === 2) return d + `L${f(pts[1][0])} ${f(pts[1][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

export function smooth(pts) {
  if (pts.length < 2) return "";
  return segments(pts, true);
}

export function joined(sides) {
  return sides.map((pts, i) => segments(pts, i === 0)).join("");
}

export function wobbleLine(r, x1, y1, x2, y2, amp = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return [[x1, y1], [x2, y2]];
  const n = Math.max(2, Math.min(14, Math.round(len / 60)));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const bow = (r() - 0.5) * Math.min(8, len * 0.02) * amp;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const jitter = (i === 0 || i === n ? 0.4 : 1) * (r() - 0.5) * 2.4 * amp;
    const off = bow * Math.sin(Math.PI * t) + jitter;
    pts.push([x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off]);
  }
  return pts;
}

export function wobbleEllipse(r, cx, cy, rx, ry) {
  const circ = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(12, Math.min(64, Math.round(circ / 24)));
  const a0 = -Math.PI / 2 - 0.5 + r() * 0.5;
  const total = Math.PI * 2 + 0.1 + r() * 0.16;
  const k1 = (r() - 0.5) * 0.05, k2 = (r() - 0.5) * 0.035, ph = r() * 6.28;
  const drift = (r() - 0.5) * 0.05;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 - total * t;
    const s = 1 + k1 * Math.sin(a * 2 + ph) + k2 * Math.sin(a * 3 + ph * 1.7) + drift * t;
    pts.push([cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s]);
  }
  return pts;
}

export function wobbleArc(r, cx, cy, rad, a1, a2) {
  const span = a2 - a1;
  const n = Math.max(4, Math.min(48, Math.round((Math.abs(span) * rad) / 22)));
  const k = (r() - 0.5) * 0.04, ph = r() * 6.28;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + (span * i) / n;
    const s = 1 + k * Math.sin(a * 2 + ph);
    pts.push([cx + Math.cos(a) * rad * s, cy - Math.sin(a) * rad * s]);
  }
  return pts;
}

export function wobblePoly(r, pts, closed, amp = 1) {
  const corners = pts.map((p) => [p[0] + (r() - 0.5) * 2 * amp, p[1] + (r() - 0.5) * 2 * amp]);
  const sides = [];
  const last = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < last; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const side = wobbleLine(r, a[0], a[1], b[0], b[1], amp);
    side[0] = a;
    side[side.length - 1] = closed && i === last - 1 ? [corners[0][0] + (r() - 0.5) * 3, corners[0][1] + (r() - 0.5) * 3] : b;
    sides.push(side);
  }
  return sides;
}

export function wobbleCurve(r, pts, amp = 1) {
  if (pts.length < 3) return wobbleLine(r, pts[0][0], pts[0][1], pts[1][0], pts[1][1], amp);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const steps = Math.max(2, Math.min(10, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 40)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const j = s === 0 ? 0 : (r() - 0.5) * 1.4 * amp;
      out.push([x + j, y + j]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function arrowHead(r, fromX, fromY, tipX, tipY, size) {
  const a = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = 0.44 + (r() - 0.5) * 0.08;
  const l1 = size * (0.95 + r() * 0.15), l2 = size * (0.95 + r() * 0.15);
  return [
    [tipX - Math.cos(a - spread) * l1, tipY - Math.sin(a - spread) * l1],
    [tipX, tipY],
    [tipX - Math.cos(a + spread) * l2, tipY - Math.sin(a + spread) * l2],
  ];
}

export function hatchLines(r, poly, spacing = 13, angle = -0.95) {
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const rot = poly.map((p) => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of rot) {
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  const lines = [];
  let flip = false;
  for (let y = y0 + spacing * 0.5; y < y1; y += spacing) {
    const xs = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i], b = rot[(i + 1) % rot.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 3) continue;
      const ya = y + (r() - 0.5) * 2.5, yb = y + (r() - 0.5) * 2.5;
      let a = [xs[i] + 1, ya], b = [xs[i + 1] - 1, yb];
      if (flip) [a, b] = [b, a];
      flip = !flip;
      const back = (p) => [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos];
      const A = back(a), B = back(b);
      lines.push(wobbleLine(r, A[0], A[1], B[0], B[1], 0.6));
    }
  }
  return lines;
}

export function penPath(pts) {
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}l0.1 0.1`;
  if (pts.length === 2) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${f(last[0])} ${f(last[1])}`;
}
