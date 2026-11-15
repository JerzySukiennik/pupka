/* Board engine: turns board-language lines into hand-drawn SVG, plays them back stroke by stroke, runs the camera, lets the student draw and sends their marks to the teacher model. */
import { rng, smooth, joined, wobbleLine, wobbleEllipse, wobbleArc, wobblePoly, wobbleCurve, arrowHead, hatchLines, penPath, bounds } from "./hand.js";
import { layout } from "./text.js";
import { parseLine, LineReader, DRAW_COMMANDS } from "./parse.js";
import { compile } from "./mathfn.js";

const NS = "http://www.w3.org/2000/svg";
const COL = 640, GAP = 76, INDENT = 52, UNIT = 6.5, BLOCK_GAP = 52, REPLY_W = 440;
const SIZE = { title: 46, head: 31, note: 27, fig: 24, small: 20, big: 31, badge: 20, tick: 15 };
const WIDTH = { normal: 3.8, thin: 2.4, thick: 6 };
const COLORS = { black: "ink", red: "red", blue: "blue", green: "green", orange: "orange", purple: "purple", gray: "gray", yellow: "yellow" };
const FLAT = { ink: "#1c1c1c", red: "#d8362f", blue: "#2b61cc", green: "#23975a", orange: "#e3851b", purple: "#8548c6", gray: "#8a9099", yellow: "#ffd426" };
const CHAR_MS = 30, PX_PER_MS = 1.25;
const MARK_DELAY = 1500;

const el = (name, attrs) => {
  const node = document.createElementNS(NS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
};
const ink = (name) => `var(--bd-${COLORS[name] || "ink"})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = (deg) => (deg * Math.PI) / 180;
const union = (a, b) => {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const hits = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
let uid = 0;

export class Board {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.api = opts.api || "";
    this.app = opts.app || "board";
    this.context = opts.context || "";
    this.listeners = [];
    this.rate = 1;
    this.autoReply = opts.autoReply !== false;
    this.tool = "pen";
    this.color = "black";
    this.cam = { cx: 0, cy: 0, k: 1 };
    this.camTo = null;
    this.follow = true;
    this.vw = 800;
    this.vh = 500;
    this.insetBottom = 0;

    this.svg = el("svg", { class: "bd-svg" });
    this.world = el("g", { class: "bd-world" });
    this.gHigh = el("g", { class: "bd-high" });
    this.gAi = el("g", { class: "bd-ai" });
    this.gUser = el("g", { class: "bd-user" });
    this.gFx = el("g", { class: "bd-fx" });
    this.pen = el("g", { class: "bd-pen" });
    this.pen.innerHTML = `<g transform="rotate(-52)"><path class="bd-pen-tip" d="M0 0L11 -4.6L11 4.6Z"/><rect class="bd-pen-body" x="11" y="-7.5" width="54" height="15" rx="5"/><rect class="bd-pen-band" x="11" y="-7.5" width="9" height="15" rx="2"/></g>`;
    this.world.append(this.gHigh, this.gAi, this.gUser, this.gFx, this.pen);
    this.svg.append(this.world);
    host.append(this.svg);

    const cs = getComputedStyle(host);
    this.hand = opts.font || cs.getPropertyValue("--bd-hand").trim() || '"Shantell Sans", cursive';
    this.weight = parseInt(cs.getPropertyValue("--bd-hand-weight"), 10) || 500;

    this.reset();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  on(fn) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }
  emit(type, data) {
    for (const fn of this.listeners) fn({ type, ...data });
  }

  async ready() {
    const family = this.hand.split(",")[0].replace(/["']/g, "").trim();
    try {
      await Promise.race([Promise.all([document.fonts.load(`${this.weight} 36px "${family}"`, "Zażółć gęślą jaźń 123"), document.fonts.ready]), new Promise((r) => setTimeout(r, 2500))]);
    } catch {}
  }

  reset() {
    if (this.ctrl) this.ctrl.abort();
    if (this.reactCtrl) this.reactCtrl.abort();
    this.ctrl = null;
    this.reactCtrl = null;
    this.reacting = null;
    this.live = null;
    clearTimeout(this.markTimer);
    this.gHigh.textContent = "";
    this.gAi.textContent = "";
    this.gUser.textContent = "";
    this.gFx.textContent = "";
    this.cols = this.opts.cols || this.autoCols();
    this.pageW = this.cols * COL + (this.cols - 1) * GAP;
    this.colY = new Array(this.cols).fill(0);
    this.blocks = [];
    this.figs = new Map();
    this.cur = { block: null, fig: null };
    this.steps = [];
    this.stepN = 0;
    this.curStep = 0;
    this.seed = 7;
    this.main = { items: [], pos: 0, t: 0 };
    this.side = { items: [], pos: 0, t: 0 };
    this.playing = true;
    this.busy = false;
    this.streaming = false;
    this.user = [];
    this.undoStack = [];
    this.marks = [];
    this.replies = [];
    this.log = [];
    this.script = "";
    this.question = "";
    this.title = "";
    this.pending = "";
    this.hasTitle = false;
    this.isIntro = false;
    this.caption = "";
    this.follow = true;
    this.pen.classList.remove("on");
    this.emit("steps");
    this.emit("caption", { text: "" });
    this.emit("state");
  }

  autoCols() {
    const aspect = this.vw / Math.max(1, this.vh);
    if (this.vw < 700 || aspect < 1.1) return 1;
    return aspect > 1.95 ? 3 : 2;
  }


  rand() {
    return rng((this.seed += 101));
  }

  pathPart(pts, o = {}) {
    const d = typeof pts === "string" ? pts : Array.isArray(pts[0][0]) ? joined(pts) : smooth(pts);
    const flat = typeof pts === "string" ? o.pts : Array.isArray(pts[0][0]) ? pts.flat() : pts;
    const box = bounds(flat);
    const len = o.len || 0;
    return { type: "path", d, pts: flat, color: o.color || "black", w: o.w || WIDTH.normal, dashed: !!o.dashed, fill: o.fill || null, solid: !!o.solid, box, speed: o.speed || 1, len };
  }

  textPart(str, x, y, o = {}) {
    const size = o.size || SIZE.note;
    const lay = layout(str, size, this.hand, this.weight, o.maxW || Infinity);
    const top = o.middle ? y - lay.h / 2 : y;
    let x0 = Infinity;
    const lines = lay.lines.map((l) => {
      const lx = o.anchor === "middle" ? x - l.w / 2 : o.anchor === "end" ? x - l.w : x;
      if (lx < x0) x0 = lx;
      return { ...l, x: lx };
    });
    if (!lines.length) x0 = x;
    const chars = String(str).length;
    return { type: "text", str: String(str), lines, color: o.color || "black", size, box: { x: x0, y: top, w: lay.w, h: lay.h }, top, dur: Math.max(170, chars * CHAR_MS) * (o.quick ? 0.4 : 1), tilt: o.tilt !== false };
  }

  shiftText(part, dx, dy) {
    part.box.x += dx;
    part.box.y += dy;
    part.top += dy;
    for (const l of part.lines) l.x += dx;
  }

  item(parts, o = {}) {
    let box = null;
    for (const p of parts) box = union(box, p.box);
    const it = { id: ++uid, parts, box, step: o.step === undefined ? this.stepN : o.step, block: o.block || this.cur.block, kind: o.kind || "draw", label: o.label || "", fig: o.fig || null, pause: o.pause === undefined ? 70 : o.pause, say: o.say || "", shown: 0, src: o.src || "ai" };
    return it;
  }

  column() {
    const min = Math.min(...this.colY);
    for (let c = 0; c < this.cols; c++) if (this.colY[c] <= min + 70) return c;
    return 0;
  }

  freeY(x, y, w) {
    const taken = this.replies.map((r) => r.box).concat(this.user.map((s) => s.box));
    for (let guard = 0; guard < 40; guard++) {
      const probe = { x, y, w, h: 230 };
      const hit = taken.find((r) => hits(probe, r, 16));
      if (!hit) break;
      y = hit.y + hit.h + 36;
    }
    return y;
  }

  closeBlock() {
    const b = this.cur.block;
    if (b && b.col !== undefined && b.kind !== "reply") this.colY[b.col] = Math.max(this.colY[b.col], b.cy + BLOCK_GAP);
  }

  openBlock(kind, extra = {}) {
    this.closeBlock();
    const col = this.column();
    const x = col * (COL + GAP);
    const y = this.freeY(x, this.colY[col], COL);
    const block = { kind, col, x, y, w: COL, cy: y, ...extra };
    this.blocks.push(block);
    this.cur = { block, fig: null };
    return block;
  }

  ensureBlock() {
    if (!this.cur.block || this.cur.block.kind === "title") this.openBlock("free");
    return this.cur.block;
  }

  ensureFig() {
    if (this.cur.fig) return this.cur.fig;
    return this.newFig("fig" + this.figs.size, 90, 44);
  }

  newFig(id, w, h) {
    const b = this.ensureBlock();
    const max = b.kind === "reply" ? (REPLY_W - 10) / UNIT : (COL - INDENT) / UNIT;
    w = clamp(w || 60, 10, 94);
    h = clamp(h || 40, 8, 72);
    const unit = w > max ? (UNIT * max) / w : UNIT;
    const fig = { id, unit, x: b.x + (b.kind === "reply" ? 6 : INDENT), y: b.cy + 10, w: w * unit, h: h * unit, uw: w, uh: h, labels: [], ink: [], axes: null, block: b, step: this.stepN };
    b.cy = fig.y + fig.h + 18;
    this.figs.set(id, fig);
    this.cur.fig = fig;
    return fig;
  }

  inkOf(fig, parts) {
    for (const p of parts) {
      if (p.type !== "path" || !p.pts) continue;
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1], b = p.pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
        for (let k = 0; k <= n; k++) fig.ink.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
  }

  placeLabel(fig, part, clampBox = true) {
    const base = { ...part.box };
    const limit = (b) => {
      if (!clampBox || fig.over) return [0, 0];
      const dx = b.x < fig.x - 14 ? fig.x - 14 - b.x : b.x + b.w > fig.x + fig.w + 14 ? fig.x + fig.w + 14 - (b.x + b.w) : 0;
      const dy = b.y < fig.y - 10 ? fig.y - 10 - b.y : b.y + b.h > fig.y + fig.h + 12 ? fig.y + fig.h + 12 - (b.y + b.h) : 0;
      return [dx, dy];
    };
    const cost = (b) => {
      let hit = 0;
      const x0 = b.x + 2, x1 = b.x + b.w - 2, y0 = b.y + b.h * 0.16, y1 = b.y + b.h * 0.9;
      for (const q of fig.ink) if (q[0] > x0 && q[0] < x1 && q[1] > y0 && q[1] < y1) hit++;
      for (const r of fig.labels) {
        const ox = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x), oy = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
        if (ox > 4 && oy > b.h * 0.25) hit += 30;
      }
      return hit;
    };
    const w = base.w, h = base.h;
    const tries = [[0, 0], [0, -h * 0.85], [0, h * 0.85], [-w * 0.56 - 6, 0], [w * 0.56 + 6, 0], [0, -h * 1.7], [0, h * 1.7], [-w * 0.56 - 6, -h * 0.85], [w * 0.56 + 6, -h * 0.85], [-w * 0.56 - 6, h * 0.85], [w * 0.56 + 6, h * 0.85]];
    let best = null;
    for (let i = 0; i < tries.length; i++) {
      const b = { x: base.x + tries[i][0], y: base.y + tries[i][1], w, h };
      const [lx, ly] = limit(b);
      b.x += lx;
      b.y += ly;
      const c = cost(b) + i * 0.4;
      if (!best || c < best.c) best = { c, b };
      if (c < 1) break;
    }
    if (best.b.x !== base.x || best.b.y !== base.y) this.shiftText(part, best.b.x - base.x, best.b.y - base.y);
    fig.labels.push({ ...part.box });
  }

  build(line) {
    const c = typeof line === "string" ? parseLine(line) : line;
    if (!c) return [];
    const out = [];
    const add = (parts, o) => {
      const it = this.item(parts, o);
      out.push(it);
      return it;
    };
    const b = () => this.ensureBlock();
    const reply = () => this.cur.block && this.cur.block.kind === "reply";
    const noteX = () => this.cur.block.x + (reply() ? 6 : INDENT);
    const noteW = () => (reply() ? REPLY_W - 12 : COL - INDENT - 10);

    switch (c.cmd) {
      case "title": {
        if (this.hasTitle) return out;
        this.hasTitle = true;
        const block = { kind: "title", x: 0, y: 0, w: this.pageW, cy: 0 };
        this.blocks.push(block);
        this.cur = { block, fig: null };
        const t = this.textPart(c.text, 0, 0, { size: SIZE.title, maxW: this.pageW - 20 });
        const r = this.rand();
        const last = t.lines[t.lines.length - 1];
        const uy = t.top + t.box.h + 6;
        const under = this.pathPart(wobbleLine(r, last.x - 4, uy + r() * 3, last.x + Math.min(last.w + 14, this.pageW), uy + r() * 3), { w: WIDTH.thick - 1 });
        add([t, under], { step: 0, kind: "title", label: c.text, pause: 260, block });
        const bottom = uy + 40;
        this.colY = this.colY.map((v) => Math.max(v, bottom));
        break;
      }
      case "step": {
        this.stepN += 1;
        const block = this.openBlock("step", { n: this.stepN });
        this.steps.push({ n: this.stepN, heading: c.text });
        const r = this.rand();
        const cx = block.x + 20, cy = block.y + 19;
        const ring = this.pathPart(wobbleEllipse(r, cx, cy, 18, 18), { color: "green", w: 3.2 });
        const num = this.textPart(String(this.stepN), cx, cy + 1, { size: SIZE.badge, color: "green", anchor: "middle", middle: true, quick: true, tilt: false });
        const head = this.textPart(c.text, block.x + INDENT, block.y, { size: SIZE.head, maxW: COL - INDENT - 10 });
        block.cy = block.y + Math.max(46, head.box.h + 8);
        const prev = this.main.items[this.main.items.length - 1];
        if (prev && this.buildingLane === this.main) prev.pause = Math.max(prev.pause, 480);
        add([ring, num, head], { kind: "head", label: c.text, pause: 200, block });
        this.emit("steps");
        break;
      }
      case "reply": {
        break;
      }
      case "say": {
        b();
        add([], { kind: "say", say: c.text, pause: 0 });
        break;
      }
      case "note": {
        const block = b();
        const t = this.textPart(c.text, noteX(), block.cy, { maxW: noteW(), color: reply() ? "blue" : "black" });
        block.cy += t.box.h + 4;
        add([t], { kind: "note", label: c.text, pause: 160 });
        break;
      }
      case "key": {
        const block = b();
        const t = this.textPart(c.text, noteX() + 14, block.cy + 12, { maxW: noteW() - 30, color: "red" });
        const r = this.rand();
        const bx = t.box.x - 13, by = t.box.y - 5, bw = t.box.w + 26, bh = t.box.h + 12;
        const frame = this.pathPart(wobblePoly(r, [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]], true, 1.2), { color: "red", w: 3.2 });
        block.cy = by + bh + 16;
        add([t, frame], { kind: "key", label: c.text, pause: 260 });
        break;
      }
      case "wrong": {
        const block = b();
        const t = this.textPart(c.text, noteX(), block.cy, { maxW: noteW(), color: "gray" });
        const r = this.rand();
        const strikes = t.lines.map((l) => this.pathPart(wobbleLine(r, l.x - 8, t.top + l.y + l.h * 0.62, l.x + l.w + 10, t.top + l.y + l.h * 0.42, 1.3), { color: "red", w: 3.6 }));
        block.cy += t.box.h + 6;
        add([t, ...strikes], { kind: "wrong", label: c.text, pause: 300 });
        break;
      }
      case "ask": {
        const block = b();
        const r = this.rand();
        const y = block.cy + 12;
        const cx = noteX() + 15, cy = y + 17;
        const ring = this.pathPart(wobbleEllipse(r, cx, cy, 15, 15), { color: "blue", w: 3 });
        const q = this.textPart("?", cx, cy + 1, { size: SIZE.badge, color: "blue", anchor: "middle", middle: true, quick: true, tilt: false });
        const t = this.textPart(c.text, noteX() + 40, y, { maxW: noteW() - 44, color: "blue" });
        block.cy = y + t.box.h + 8;
        this.pending = c.text;
        add([ring, q, t], { kind: "ask", label: c.text, pause: 200 });
        break;
      }
      case "over": {
        if (this.overFig) this.cur.fig = this.overFig;
        break;
      }
      default:
        if (DRAW_COMMANDS.has(c.cmd)) {
          this.draw(c, (parts, o) => {
            const it = add(parts, o);
            if (it.fig) this.inkOf(it.fig, parts);
            return it;
          });
        }
    }
    return out;
  }

  draw(c, add) {
    const n = c.nums, m = c.mods, s = c.strs;
    if (c.cmd === "fig") {
      const id = (c.words && c.words[0]) || "A";
      const known = this.figs.get(id);
      if (known) this.cur.fig = known;
      else this.newFig(id, n[0], n[1]);
      return;
    }
    const fig = this.ensureFig();
    const U = fig.unit;
    const X = (v) => fig.x + v * U, Y = (v) => fig.y + v * U;
    const r = this.rand();
    const color = m.color || "black";
    const w = m.thick ? WIDTH.thick : m.thin ? WIDTH.thin : WIDTH.normal;
    const style = { color, w, dashed: m.dashed };
    const o = { fig, label: s[0] || "" };
    const need = (k) => n.length >= k && n.slice(0, k).every((v) => Number.isFinite(v));
    const tsize = m.big ? SIZE.big : m.small ? SIZE.small : SIZE.fig;
    const head = (from, tip) => this.pathPart(arrowHead(r, from[0], from[1], tip[0], tip[1], 12 + w * 2), { color, w });
    const pairs = () => {
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([X(n[i]), Y(n[i + 1])]);
      return pts;
    };
    const label = (str, x, y, extra = {}) => {
      const t = this.textPart(str, x, y, { size: tsize, color, anchor: "middle", middle: true, ...extra });
      this.placeLabel(fig, t, extra.clamp !== false);
      return t;
    };

    switch (c.cmd) {
      case "line": {
        if (!need(4)) return;
        add([this.pathPart(wobbleLine(r, X(n[0]), Y(n[1]), X(n[2]), Y(n[3])), style)], o);
        break;
      }
      case "arrow": {
        if (!need(4)) return;
        const pts = wobbleLine(r, X(n[0]), Y(n[1]), X(n[2]), Y(n[3]));
        add([this.pathPart(pts, style), head(pts[Math.max(0, pts.length - 2)], pts[pts.length - 1])], o);
        break;
      }
      case "circle":
      case "ellipse": {
        if (!need(c.cmd === "circle" ? 3 : 4)) return;
        const rx = Math.abs(n[2]) * U, ry = Math.abs(c.cmd === "circle" ? n[2] : n[3]) * U;
        const pts = wobbleEllipse(r, X(n[0]), Y(n[1]), Math.max(2, rx), Math.max(2, ry));
        add([this.pathPart(pts, { ...style, fill: m.fill ? color : null })], o);
        break;
      }
      case "rect": {
        if (!need(4)) return;
        const x = X(n[0]), y = Y(n[1]), rw = n[2] * U, rh = n[3] * U;
        add([this.pathPart(wobblePoly(r, [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]], true), { ...style, fill: m.fill ? color : null })], o);
        break;
      }
      case "poly":
      case "polyline": {
        const pts = pairs();
        if (pts.length < 2) return;
        const closed = c.cmd === "poly" && pts.length > 2;
        const sides = wobblePoly(r, pts, closed);
        const parts = [this.pathPart(sides, { ...style, fill: closed && m.fill ? color : null })];
        if (!closed && m.arrow) {
          const lastSide = sides[sides.length - 1];
          parts.push(head(lastSide[Math.max(0, lastSide.length - 2)], lastSide[lastSide.length - 1]));
        }
        add(parts, o);
        break;
      }
      case "curve": {
        const pts = pairs();
        if (pts.length < 2) return;
        const cv = wobbleCurve(r, pts);
        const parts = [this.pathPart(cv, style)];
        if (m.arrow) parts.push(head(cv[Math.max(0, cv.length - 3)], cv[cv.length - 1]));
        add(parts, o);
        break;
      }
      case "arc": {
        if (!need(5)) return;
        const pts = wobbleArc(r, X(n[0]), Y(n[1]), Math.abs(n[2]) * U, rad(n[3]), rad(n[4]));
        const parts = [this.pathPart(pts, style)];
        if (m.arrow) parts.push(head(pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]));
        add(parts, o);
        break;
      }
      case "hatch": {
        const pts = pairs();
        if (pts.length < 3) return;
        const lines = hatchLines(r, pts, 13);
        if (!lines.length) return;
        add(lines.map((l) => this.pathPart(l, { color, w: 3, speed: 2.4 })), o);
        break;
      }
      case "text": {
        if (!need(2) || !s[0]) return;
        const t = label(s[0], X(n[0]), Y(n[1]), { anchor: m.left ? "start" : m.right ? "end" : "middle" });
        add([t], { ...o, kind: "label" });
        break;
      }
      case "dot": {
        if (!need(2)) return;
        const x = X(n[0]), y = Y(n[1]);
        const parts = [this.pathPart(wobbleEllipse(r, x, y, 5, 5), { color, w: 3, fill: color, solid: true })];
        if (s[0]) parts.push(label(s[0], x + 12, y - 16, { anchor: "start" }));
        add(parts, { ...o, kind: "label" });
        break;
      }
      case "dim": {
        if (!need(4)) return;
        const x1 = X(n[0]), y1 = Y(n[1]), x2 = X(n[2]), y2 = Y(n[3]);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
        if (ny < -0.01 || (Math.abs(ny) < 0.01 && nx < 0)) { nx = -nx; ny = -ny; }
        const tick = 8;
        const parts = [
          this.pathPart(wobbleLine(r, x1, y1, x2, y2, 0.6), { color, w: WIDTH.thin }),
          this.pathPart(wobbleLine(r, x1 - nx * tick, y1 - ny * tick, x1 + nx * tick, y1 + ny * tick, 0.4), { color, w: WIDTH.thin }),
          this.pathPart(wobbleLine(r, x2 - nx * tick, y2 - ny * tick, x2 + nx * tick, y2 + ny * tick, 0.4), { color, w: WIDTH.thin }),
        ];
        if (s[0]) {
          const off = tsize * 0.72 + 4;
          parts.push(label(s[0], (x1 + x2) / 2 + nx * off, (y1 + y2) / 2 + ny * off));
        }
        add(parts, { ...o, kind: "label" });
        break;
      }
      case "angle": {
        if (!need(4)) return;
        const cx = X(n[0]), cy = Y(n[1]);
        let a1 = n[2], a2 = n[3];
        if (a2 < a1) [a1, a2] = [a2, a1];
        if (a2 - a1 > 180) [a1, a2] = [a2, a1 + 360];
        const R = 38;
        const parts = [this.pathPart(wobbleArc(r, cx, cy, R, rad(a1), rad(a2)), { color, w: WIDTH.thin + 0.6 })];
        if (s[0]) {
          const mid = rad((a1 + a2) / 2);
          parts.push(label(s[0], cx + Math.cos(mid) * (R + 30), cy - Math.sin(mid) * (R + 30)));
        }
        add(parts, { ...o, kind: "label" });
        break;
      }
      case "badge": {
        if (!need(2)) return;
        const cx = X(n[0]), cy = Y(n[1]);
        add([this.pathPart(wobbleEllipse(r, cx, cy, 15, 15), { color: "green", w: 2.8 }), this.textPart(String(this.stepN || ""), cx, cy + 1, { size: 17, color: "green", anchor: "middle", middle: true, quick: true, tilt: false })], { fig });
        break;
      }
      case "axes": {
        if (!need(8) || n[5] <= n[4] || n[7] <= n[6]) return;
        const ax = { x: X(n[0]), y: Y(n[1]), w: n[2] * U, h: n[3] * U, x0: n[4], x1: n[5], y0: n[6], y1: n[7] };
        ax.X = (v) => ax.x + ((v - ax.x0) / (ax.x1 - ax.x0)) * ax.w;
        ax.Y = (v) => ax.y + ax.h - ((v - ax.y0) / (ax.y1 - ax.y0)) * ax.h;
        fig.axes = ax;
        const oy = ax.Y(clamp(0, ax.y0, ax.y1)), ox = ax.X(clamp(0, ax.x0, ax.x1));
        const xa = wobbleLine(r, ax.x - 6, oy, ax.x + ax.w + 16, oy, 0.6), ya = wobbleLine(r, ox, ax.y + ax.h + 6, ox, ax.y - 16, 0.6);
        const parts = [this.pathPart(xa, { w: 3.2 }), this.pathPart(arrowHead(r, ax.x, oy, ax.x + ax.w + 16, oy, 13), { w: 3.2 }), this.pathPart(ya, { w: 3.2 }), this.pathPart(arrowHead(r, ox, ax.y + ax.h, ox, ax.y - 16, 13), { w: 3.2 })];
        const nice = (span) => {
          const raw = span / 7, p = Math.pow(10, Math.floor(Math.log10(raw)));
          return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= raw) || raw;
        };
        const fmt = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");
        const sx = nice(ax.x1 - ax.x0), sy = nice(ax.y1 - ax.y0);
        const ticks = [];
        for (let v = Math.ceil(ax.x0 / sx) * sx; v <= ax.x1 + 1e-9; v += sx) {
          if (Math.abs(v) < 1e-9) continue;
          parts.push(this.pathPart([[ax.X(v), oy - 5], [ax.X(v), oy + 5]], { w: 2.4, speed: 3 }));
          ticks.push(this.textPart(fmt(v), ax.X(v), oy + 8, { size: SIZE.tick, color: "gray", anchor: "middle", quick: true, tilt: false }));
        }
        for (let v = Math.ceil(ax.y0 / sy) * sy; v <= ax.y1 + 1e-9; v += sy) {
          if (Math.abs(v) < 1e-9) continue;
          parts.push(this.pathPart([[ox - 5, ax.Y(v)], [ox + 5, ax.Y(v)]], { w: 2.4, speed: 3 }));
          ticks.push(this.textPart(fmt(v), ox - 10, ax.Y(v), { size: SIZE.tick, color: "gray", anchor: "end", middle: true, quick: true, tilt: false }));
        }
        ticks.push(this.textPart("x", ax.x + ax.w + 22, oy + 6, { size: SIZE.small, color: "gray", quick: true, tilt: false }));
        ticks.push(this.textPart("y", ox + 12, ax.y - 30, { size: SIZE.small, color: "gray", quick: true, tilt: false }));
        add(parts.concat(ticks), { fig, label: "axes" });
        break;
      }
      case "plot": {
        const ax = fig.axes, fn = compile(c.expr);
        if (!ax || !fn) return;
        const runs = [];
        let run = [];
        const N = 90;
        for (let i = 0; i <= N; i++) {
          const xv = ax.x0 + ((ax.x1 - ax.x0) * i) / N, yv = fn(xv);
          const ok = Number.isFinite(yv) && yv >= ax.y0 - (ax.y1 - ax.y0) * 0.02 && yv <= ax.y1 + (ax.y1 - ax.y0) * 0.02;
          if (ok) run.push([ax.X(xv) + (r() - 0.5) * 0.8, ax.Y(yv) + (r() - 0.5) * 0.8]);
          else if (run.length) { runs.push(run); run = []; }
        }
        if (run.length) runs.push(run);
        const parts = runs.filter((p) => p.length > 1).map((p) => this.pathPart(p, { color: m.color || "blue", w: m.thick ? WIDTH.thick : WIDTH.normal + 0.4, dashed: m.dashed }));
        if (parts.length) add(parts, { fig, label: "y = " + c.expr });
        break;
      }
      case "pt": {
        const ax = fig.axes;
        if (!ax || !need(2)) return;
        const x = ax.X(n[0]), y = ax.Y(n[1]);
        const parts = [this.pathPart(wobbleEllipse(r, x, y, 5.5, 5.5), { color, w: 3, fill: color, solid: true })];
        if (s[0]) parts.push(label(s[0], x + 12, y - 18, { anchor: "start", size: SIZE.small + 2 }));
        add(parts, { ...o, kind: "label" });
        break;
      }
      case "seg": {
        const ax = fig.axes;
        if (!ax || !need(4)) return;
        add([this.pathPart(wobbleLine(r, ax.X(n[0]), ax.Y(n[1]), ax.X(n[2]), ax.Y(n[3]), 0.7), style)], o);
        break;
      }
    }
  }


  mount(it) {
    const g = el("g", { class: "bd-item" });
    g.style.display = "none";
    for (const p of it.parts) {
      if (p.type === "path") {
        if (p.fill) {
          p.fillEl = el("path", { d: p.d + "Z", class: "bd-fill" });
          p.fillEl.style.fill = ink(p.fill);
          if (p.solid) p.fillEl.classList.add("solid");
          g.append(p.fillEl);
        }
        p.el = el("path", { d: p.d, class: "bd-stroke", "stroke-width": p.w });
        p.el.style.stroke = ink(p.color);
        g.append(p.el);
      } else {
        p.g = el("g", { class: "bd-text" });
        p.g.style.fill = ink(p.color);
        p.rects = [];
        for (const l of p.lines) {
          const id = "bdc" + ++uid;
          const clip = el("clipPath", { id });
          const rect = el("rect", { x: l.x - 6, y: p.top + l.y - 10, width: 0, height: l.h + 22 });
          clip.append(rect);
          const lg = el("g", { "clip-path": `url(#${id})` });
          for (const run of l.parts) {
            if (run.bar) lg.append(el("rect", { x: l.x + run.x, y: p.top + l.base + run.dy - 1.4, width: run.w, height: 2.8, rx: 1.4 }));
            else {
              const t = el("text", { x: l.x + run.x, y: p.top + l.base + run.dy, "font-size": run.size });
              t.textContent = run.str;
              lg.append(t);
            }
          }
          if (p.tilt) {
            const a = (((it.id * 37 + p.rects.length * 11) % 13) - 6) * 0.09;
            lg.setAttribute("transform", `rotate(${a} ${l.x} ${p.top + l.base})`);
          }
          p.g.append(clip, lg);
          p.rects.push({ rect, lg, w: l.w + 14, x: l.x, base: p.top + l.base, chars: Math.max(1, l.chars) });
        }
        g.append(p.g);
      }
    }
    it.g = g;
    this.gAi.append(g);
    let dur = 0;
    for (const p of it.parts) {
      if (p.type === "path") {
        p.len = p.el.getTotalLength() || 1;
        p.dur = clamp(p.len / (PX_PER_MS * p.speed), 45, 1100);
      }
      dur += p.dur;
    }
    it.dur = dur;
  }

  progress(it, t) {
    let at = 0;
    for (const p of it.parts) {
      const local = clamp((t - at) / p.dur, 0, 1);
      at += p.dur;
      if (p.done === local) continue;
      p.done = local;
      if (p.type === "path") {
        if (local >= 1) {
          p.el.style.strokeDasharray = p.dashed ? "11 10" : "";
          p.el.style.strokeDashoffset = "";
          p.el.style.visibility = "";
          if (p.fillEl) p.fillEl.classList.add("in");
        } else if (local <= 0) {
          p.el.style.visibility = "hidden";
          if (p.fillEl) p.fillEl.classList.remove("in");
        } else {
          const shown = p.len * local;
          p.el.style.visibility = "";
          if (p.dashed) {
            const full = Math.floor(shown / 21), rest = shown - full * 21;
            p.el.style.strokeDasharray = "11 10 ".repeat(full) + `${Math.min(11, rest).toFixed(1)} ${p.len + 30}`;
          } else {
            p.el.style.strokeDasharray = `${p.len + 2} ${p.len + 2}`;
            p.el.style.strokeDashoffset = String(p.len + 2 - shown);
          }
          this.penAt = p.el.getPointAtLength(shown);
          this.penColor = p.color;
        }
      } else {
        const total = p.rects.reduce((sum, r) => sum + r.chars, 0);
        let acc = 0;
        for (const r of p.rects) {
          const lt = clamp((local * total - acc) / r.chars, 0, 1);
          acc += r.chars;
          if (lt >= 1) {
            if (r.clipped !== false) { r.lg.removeAttribute("clip-path"); r.clipped = false; }
          } else {
            if (r.clipped === false) { r.lg.setAttribute("clip-path", `url(#${r.rect.parentNode.id})`); r.clipped = true; }
            r.rect.setAttribute("width", (r.w * lt).toFixed(1));
            if (lt > 0) {
              this.penAt = { x: r.x + r.w * lt - 6, y: r.base - p.size * 0.28 + Math.sin(lt * r.chars * 1.9) * p.size * 0.14 };
              this.penColor = p.color;
            }
          }
        }
      }
    }
  }

  show(it, full) {
    if (!it.g) return;
    it.g.style.display = "";
    if (full) {
      this.progress(it, it.dur + 1);
      it.shown = 2;
    }
  }

  hide(it) {
    if (!it.g) return;
    it.g.style.display = "none";
    for (const p of it.parts) p.done = undefined;
    this.progress(it, 0);
    it.shown = 0;
  }


  push(lane, items) {
    for (const it of items) {
      this.mount(it);
      lane.items.push(it);
    }
    this.kick();
  }

  feed(text, o = {}) {
    this.buildingLane = this.main;
    const items = [];
    for (const line of text.split("\n")) items.push(...this.build(line));
    this.push(this.main, items);
    if (o.instant) this.finishAll();
  }

  finishAll() {
    for (const lane of [this.main, this.side]) {
      for (const it of lane.items) this.show(it, true);
      lane.pos = lane.items.length;
      lane.t = 0;
    }
    const last = [...this.main.items].reverse().find((it) => it.say);
    if (last) this.setCaption(last.say);
    this.curStep = this.stepN;
    this.pen.classList.remove("on");
    this.emit("steps");
    this.emit("state");
    const all = this.contentBox(true);
    if (all && this.camFor(grow(all, 6)).k >= this.minK * 0.82) this.fit(false);
    else if (all) {
      const k = Math.max(this.minK, Math.min(1, (this.vw - 40) / all.w));
      this.cam = { k, cx: all.x + all.w / 2, cy: all.y + this.vh / 2 / k - 24 };
      this.camTo = null;
      this.applyCam();
    }
  }

  kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  activeLane() {
    if (this.side.pos < this.side.items.length) return this.side;
    if (this.playing && this.main.pos < this.main.items.length) return this.main;
    return null;
  }

  tick(now) {
    this.raf = 0;
    const real = this.last ? Math.min(60, now - this.last) : 16;
    this.last = now;
    let again = this.moveCam(real);
    const lane = this.activeLane();
    if (lane) {
      let budget = real * this.rate;
      while (budget > 0 && lane.pos < lane.items.length) {
        const it = lane.items[lane.pos];
        if (it.shown === 0) this.start(it, lane);
        const total = it.dur + it.pause;
        const use = Math.min(budget, total - lane.t);
        lane.t += use;
        budget -= use;
        this.progress(it, Math.min(lane.t, it.dur));
        if (lane.t >= total - 0.01) {
          it.shown = 2;
          lane.pos += 1;
          lane.t = 0;
          if (lane.pos >= lane.items.length) this.laneEnd(lane);
        }
      }
      this.movePen(true);
      again = true;
    } else this.movePen(false);
    if (again || this.activeLane()) this.kick();
    else this.last = 0;
  }

  start(it, lane) {
    it.shown = 1;
    it.g.style.display = "";
    this.progress(it, 0);
    if (it.say) this.setCaption(it.say);
    if (lane === this.main && it.step && it.step !== this.curStep) {
      this.curStep = it.step;
      this.emit("steps");
    }
    if (it.box) this.focus(it, lane);
  }

  laneEnd(lane) {
    if (lane === this.main && !this.streaming) {
      this.emit("state");
      if (this.follow) this.settle();
    }
    if (lane === this.side) this.emit("state");
  }

  setCaption(text) {
    this.caption = text;
    this.emit("caption", { text });
  }

  movePen(on) {
    if (on && this.penAt) {
      const k = clamp(1 / this.cam.k, 0.8, 1.5);
      this.pen.setAttribute("transform", `translate(${this.penAt.x.toFixed(1)} ${this.penAt.y.toFixed(1)}) scale(${k.toFixed(2)})`);
      this.pen.style.setProperty("--bd-pen-ink", ink(this.penColor));
      this.pen.classList.add("on");
    } else this.pen.classList.remove("on");
  }

  get atEnd() {
    return this.main.pos >= this.main.items.length;
  }

  play() {
    if (this.atEnd && !this.streaming && this.steps.length) return this.goStep(1);
    this.playing = true;
    this.follow = true;
    this.emit("state");
    this.kick();
  }
  pause() {
    this.playing = false;
    this.emit("state");
  }
  toggle() {
    if (this.playing && !(this.atEnd && !this.streaming)) this.pause();
    else this.play();
  }

  goStep(n) {
    n = clamp(n, 1, Math.max(1, this.steps.length));
    let pos = this.main.items.length;
    this.main.items.forEach((it, i) => {
      if (it.step < n) this.show(it, true);
      else {
        this.hide(it);
        if (i < pos) pos = i;
      }
    });
    this.main.pos = pos;
    this.main.t = 0;
    this.curStep = n;
    this.playing = true;
    this.follow = true;
    this.setCaption("");
    this.emit("steps");
    this.emit("state");
    this.kick();
  }

  showStep(n) {
    n = clamp(n, 1, Math.max(1, this.steps.length));
    let pos = this.main.items.length;
    let say = "";
    this.main.items.forEach((it, i) => {
      if (it.step <= n) {
        this.show(it, true);
        if (it.say) say = it.say;
      } else {
        this.hide(it);
        if (i < pos) pos = i;
      }
    });
    this.main.pos = pos;
    this.main.t = 0;
    this.curStep = n;
    this.playing = false;
    this.follow = true;
    this.setCaption(say);
    const block = this.blocks.find((b) => b.kind === "step" && b.n === n);
    if (block) this.focusBox(this.blockBox(block));
    this.emit("steps");
    this.emit("state");
    this.kick();
  }


  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = !this.sized;
    this.vw = r.width;
    this.vh = r.height;
    this.sized = true;
    this.svg.setAttribute("viewBox", `0 0 ${this.vw} ${this.vh}`);
    if (first) {
      if (!this.main.items.length && !this.user.length) {
        this.cols = this.opts.cols || this.autoCols();
        this.pageW = this.cols * COL + (this.cols - 1) * GAP;
        this.colY = new Array(this.cols).fill(0);
      }
      const k = Math.min(1, (this.vw - 60) / this.pageW);
      this.cam = { k, cx: this.pageW / 2, cy: this.vh / 2 / k - 34 };
    }
    this.applyCam();
    if (this.follow && !first && !this.activeLane()) this.settle();
  }

  applyCam() {
    const { cx, cy, k } = this.cam;
    this.world.setAttribute("transform", `translate(${(this.vw / 2 - cx * k).toFixed(2)} ${(this.vh / 2 - cy * k).toFixed(2)}) scale(${k.toFixed(4)})`);
  }

  camFor(box, pad = 46, maxK = 1.05) {
    const k = Math.min(maxK, (this.vw - pad * 2) / Math.max(60, box.w), (this.vh - this.insetBottom - pad * 2) / Math.max(60, box.h));
    return { k, cx: box.x + box.w / 2, cy: box.y + box.h / 2 + this.insetBottom / 2 / k };
  }

  panTo(box, k, all) {
    const cur = this.camTo || this.cam;
    const vw = this.vw / k, vh = (this.vh - this.insetBottom) / k, m = 40 / k;
    let x0 = cur.cx - vw / 2, y0 = cur.cy - this.vh / 2 / k;
    if (all && all.w + 2 * m <= vw) x0 = all.x + all.w / 2 - vw / 2;
    else if (box.w + 2 * m > vw) x0 = box.x - m;
    else {
      if (box.x < x0 + m) x0 = box.x - m;
      if (box.x + box.w > x0 + vw - m) x0 = box.x + box.w + m - vw;
    }
    if (box.h + 2 * m > vh) y0 = box.y + box.h + m - vh;
    else {
      if (box.y < y0 + m) y0 = box.y - m;
      if (box.y + box.h > y0 + vh - m) y0 = box.y + box.h + m - vh;
    }
    if (all && y0 < all.y - m) y0 = all.y - m;
    const to = { k, cx: x0 + vw / 2, cy: y0 + this.vh / 2 / k };
    if (Math.abs(to.cx - cur.cx) < 2 && Math.abs(to.cy - cur.cy) < 2 && Math.abs(to.k / cur.k - 1) < 0.01) return;
    this.camTo = to;
    this.kick();
  }

  allVisible() {
    const all = this.contentBox(true);
    if (!all) return true;
    const v = this.view(this.camTo || this.cam);
    return all.x >= v.x - 2 && all.y >= v.y - 2 && all.x + all.w <= v.x + v.w + 2 && all.y + all.h <= v.y + v.h + 2;
  }

  view(cam = this.cam) {
    return { x: cam.cx - this.vw / 2 / cam.k, y: cam.cy - this.vh / 2 / cam.k, w: this.vw / cam.k, h: this.vh / cam.k };
  }

  moveCam(dt) {
    if (!this.camTo) return false;
    const a = 1 - Math.exp(-dt / 190);
    const c = this.cam, to = this.camTo;
    c.cx += (to.cx - c.cx) * a;
    c.cy += (to.cy - c.cy) * a;
    c.k = Math.exp(Math.log(c.k) + (Math.log(to.k) - Math.log(c.k)) * a);
    if (Math.abs(to.cx - c.cx) < 0.4 && Math.abs(to.cy - c.cy) < 0.4 && Math.abs(to.k / c.k - 1) < 0.002) {
      this.cam = { ...to };
      this.camTo = null;
    }
    this.applyCam();
    return !!this.camTo;
  }

  contentBox(shownOnly) {
    let box = null;
    for (const lane of [this.main, this.side]) for (const it of lane.items) if (it.box && (!shownOnly || it.shown)) box = union(box, it.box);
    for (const f of this.figs.values()) if (!f.over && (!shownOnly || this.main.items.some((it) => it.fig === f && it.shown))) box = union(box, { x: f.x, y: f.y, w: f.w, h: f.h });
    for (const s of this.user) box = union(box, s.box);
    return box;
  }

  blockBox(block) {
    let box = { x: block.x, y: block.y, w: block.w, h: Math.max(60, block.cy - block.y) };
    for (const lane of [this.main, this.side]) for (const it of lane.items) if (it.block === block && it.box) box = union(box, it.box);
    return box;
  }

  focusBox(box) {
    this.camTo = this.camFor(box);
    this.kick();
  }

  reveal(box, pad = 44) {
    const cur = this.camTo || this.cam;
    const v = this.view(cur);
    const m = pad / cur.k;
    if (box.x >= v.x + m && box.y >= v.y + m && box.x + box.w <= v.x + v.w - m && box.y + box.h <= v.y + v.h - m) return;
    if (box.w + 2 * m <= v.w && box.h + 2 * m <= v.h) {
      let { cx, cy } = cur;
      if (box.x < v.x + m) cx -= v.x + m - box.x;
      else if (box.x + box.w > v.x + v.w - m) cx += box.x + box.w - (v.x + v.w - m);
      if (box.y < v.y + m) cy -= v.y + m - box.y;
      else if (box.y + box.h > v.y + v.h - m) cy += box.y + box.h - (v.y + v.h - m);
      this.camTo = { k: cur.k, cx, cy };
    } else this.camTo = this.camFor(box, pad, cur.k);
    this.kick();
  }

  focus(it, lane) {
    if (lane === this.side) {
      if (it.reveal) this.reveal(it.reveal);
      return;
    }
    if (!this.follow) return;
    const all = this.contentBox(false);
    const whole = all && this.camFor(grow(all, 6));
    const minK = this.minK;
    if (whole && whole.k >= minK) {
      const cur = this.camTo || this.cam;
      if (Math.abs(whole.k / cur.k - 1) > 0.03 || Math.abs(whole.cx - cur.cx) > 12 || Math.abs(whole.cy - cur.cy) > 12) this.focusBox(grow(all, 6));
      return;
    }
    let box = it.block ? this.blockBox(it.block) : it.box;
    if (it.fig && !it.fig.over) box = union(box, { x: it.fig.x, y: it.fig.y, w: it.fig.w, h: it.fig.h });
    const viewH = (this.vh - this.insetBottom) / minK - 80 / minK;
    if (box.h > viewH) box = union(it.box, { x: box.x, y: Math.max(box.y, it.box.y + it.box.h - viewH), w: box.w, h: 1 });
    this.panTo(box, minK, all);
  }

  get minK() {
    return this.vw < 700 ? 0.5 : 0.56;
  }

  settle() {
    const all = this.contentBox(true);
    if (all && this.camFor(grow(all, 6)).k >= this.minK * 0.82) this.fit(true);
  }

  fit(animated = true) {
    const all = this.contentBox(true);
    this.follow = true;
    if (!all) return;
    const to = this.camFor(grow(all, 6));
    if (animated) {
      this.camTo = to;
      this.kick();
    } else {
      this.cam = to;
      this.camTo = null;
      this.applyCam();
    }
    this.emit("state");
  }

  toBoard(ev) {
    const r = this.svg.getBoundingClientRect();
    return [(ev.clientX - r.left - this.vw / 2) / this.cam.k + this.cam.cx, (ev.clientY - r.top - this.vh / 2) / this.cam.k + this.cam.cy];
  }

  zoomAt(ev, factor) {
    const before = this.toBoard(ev);
    this.cam.k = clamp(this.cam.k * factor, 0.12, 3);
    const after = this.toBoard(ev);
    this.cam.cx += before[0] - after[0];
    this.cam.cy += before[1] - after[1];
    this.userCam();
  }

  userCam() {
    this.camTo = null;
    if (this.follow) {
      this.follow = false;
      this.emit("state");
    }
    this.applyCam();
  }


  bind() {
    const svg = this.svg;
    const pointers = new Map();
    let stroke = null, pan = null, pinch = null;

    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) this.zoomAt(ev, Math.exp(-ev.deltaY * 0.012));
      else {
        this.cam.cx += ev.deltaX / this.cam.k;
        this.cam.cy += ev.deltaY / this.cam.k;
        this.userCam();
      }
    }, { passive: false });

    const cancelStroke = () => {
      if (stroke) stroke.el.remove();
      stroke = null;
    };

    svg.addEventListener("pointerdown", (ev) => {
      if (ev.button > 1) return;
      svg.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, ev);
      clearTimeout(this.markTimer);
      if (pointers.size === 2) {
        cancelStroke();
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
        pan = null;
        return;
      }
      if (this.tool === "hand" || ev.button === 1 || this.spaceDown) {
        pan = { x: ev.clientX, y: ev.clientY };
        svg.classList.add("panning");
        return;
      }
      const p = this.toBoard(ev);
      if (this.tool === "eraser") {
        stroke = { erase: true, removed: [] };
        this.eraseAt(p, stroke);
        return;
      }
      if (this.reacting && !this.reacting.placed) this.cancelReact();
      const high = this.tool === "high";
      stroke = { pts: [p], color: high ? "yellow" : this.color, w: high ? 26 : 4.6, tool: high ? "high" : "pen" };
      stroke.el = el("path", { class: high ? "bd-user-high" : "bd-user-stroke", "stroke-width": stroke.w, d: penPath(stroke.pts) });
      stroke.el.style.stroke = ink(stroke.color);
      (high ? this.gHigh : this.gUser).append(stroke.el);
    });

    svg.addEventListener("pointermove", (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, ev);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
        this.cam.cx -= (mx - pinch.mx) / this.cam.k;
        this.cam.cy -= (my - pinch.my) / this.cam.k;
        this.zoomAt({ clientX: mx, clientY: my }, d / (pinch.d || d));
        pinch = { d, mx, my };
        return;
      }
      if (pan) {
        this.cam.cx -= (ev.clientX - pan.x) / this.cam.k;
        this.cam.cy -= (ev.clientY - pan.y) / this.cam.k;
        pan = { x: ev.clientX, y: ev.clientY };
        this.userCam();
        return;
      }
      if (!stroke) return;
      const p = this.toBoard(ev);
      if (stroke.erase) return this.eraseAt(p, stroke);
      const last = stroke.pts[stroke.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.6 / this.cam.k) return;
      stroke.pts.push(p);
      stroke.el.setAttribute("d", penPath(stroke.pts));
    });

    const up = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pan) {
        pan = null;
        svg.classList.remove("panning");
      }
      if (!stroke) {
        if (this.marks.length && this.autoReply && !pointers.size) this.armReact();
        return;
      }
      const s = stroke;
      stroke = null;
      if (s.erase) {
        if (s.removed.length) this.undoStack.push({ erased: s.removed });
        this.emit("state");
        return;
      }
      s.box = grow(bounds(s.pts), s.w / 2);
      s.d = penPath(s.pts);
      this.user.push(s);
      this.undoStack.push({ added: s });
      this.marks.push(s);
      this.emit("state");
      if (this.autoReply) this.armReact();
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);

    this.keyDown = (ev) => {
      if (ev.code === "Space" && !/input|textarea/i.test(ev.target.tagName)) this.spaceDown = true;
    };
    this.keyUp = (ev) => {
      if (ev.code === "Space") this.spaceDown = false;
    };
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
  }

  eraseAt(p, stroke) {
    const reach = 16 / this.cam.k;
    for (const s of [...this.user]) {
      if (p[0] < s.box.x - reach || p[0] > s.box.x + s.box.w + reach || p[1] < s.box.y - reach || p[1] > s.box.y + s.box.h + reach) continue;
      if (!s.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < reach + s.w / 2)) continue;
      s.el.remove();
      this.user = this.user.filter((u) => u !== s);
      this.marks = this.marks.filter((u) => u !== s);
      stroke.removed.push(s);
    }
  }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    if (op.added) {
      op.added.el.remove();
      this.user = this.user.filter((u) => u !== op.added);
      this.marks = this.marks.filter((u) => u !== op.added);
      if (!this.marks.length) clearTimeout(this.markTimer);
    } else {
      for (const s of op.erased) {
        (s.tool === "high" ? this.gHigh : this.gUser).append(s.el);
        this.user.push(s);
      }
    }
    this.emit("state");
  }

  setTool(tool, color) {
    this.tool = tool;
    if (color) this.color = color;
    this.svg.dataset.tool = tool;
    this.emit("state");
  }

  setAutoReply(on) {
    this.autoReply = on;
    if (!on) clearTimeout(this.markTimer);
    else if (this.marks.length) this.armReact();
    this.emit("state");
  }


  armReact() {
    clearTimeout(this.markTimer);
    this.markTimer = setTimeout(() => this.react(), MARK_DELAY);
  }

  cancelReact() {
    if (this.reactCtrl) this.reactCtrl.abort();
    this.reactCtrl = null;
    this.reacting = null;
    this.gFx.textContent = "";
    this.emit("state");
  }

  nearText(box) {
    const probe = grow(box, 46);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const found = [];
    for (const lane of [this.main, this.side]) {
      for (const it of lane.items) {
        if (!it.label || !it.shown || !it.box || !hits(probe, it.box)) continue;
        const dist = Math.hypot(it.box.x + it.box.w / 2 - cx, it.box.y + it.box.h / 2 - cy);
        const where = it.fig && !it.fig.over ? `in drawing ${it.fig.id}` : it.kind;
        const step = it.step ? `, step ${it.step}` : "";
        found.push({ dist, text: `"${it.label}" (${where}${step})` });
      }
    }
    for (const f of this.figs.values()) {
      if (f.over || !hits(probe, { x: f.x, y: f.y, w: f.w, h: f.h })) continue;
      const ux = ((cx - f.x) / f.unit).toFixed(0), uy = ((cy - f.y) / f.unit).toFixed(0);
      found.push({ dist: 1e6, text: `the marks are on drawing ${f.id}, around x ${ux} y ${uy} in its coordinates` });
    }
    return found.sort((a, b) => a.dist - b.dist).map((f) => f.text);
  }

  region(box) {
    let r = grow(box, 190);
    const minW = 760, minH = 500;
    if (r.w < minW) r = { ...r, x: r.x - (minW - r.w) / 2, w: minW };
    if (r.h < minH) r = { ...r, y: r.y - (minH - r.h) / 2, h: minH };
    if (r.w / r.h > 2.1) { const h = r.w / 2.1; r = { ...r, y: r.y - (h - r.h) / 2, h }; }
    if (r.h / r.w > 1.4) { const w = r.h / 1.4; r = { ...r, x: r.x - (w - r.w) / 2, w }; }
    return r;
  }

  async react() {
    const marks = this.marks.filter((s) => this.user.includes(s));
    if (!marks.length || !this.api) return;
    let box = null;
    for (const s of marks) box = union(box, s.box);
    const region = this.region(box);
    const image = this.snapshot(region, { marks, grid: true, maxSide: 900 }).toDataURL("image/jpeg", 0.82).split(",")[1];
    const near = this.nearText(box);
    const ctrl = new AbortController();
    this.reactCtrl = ctrl;
    this.reacting = { marks, placed: false };
    this.thinkingAt(box);
    this.emit("state");
    let text = "";
    try {
      await this.stream({ kind: "reply", image, near, pending: this.pending, board: this.script + (this.live ? this.live.text : ""), context: this.context }, (chunk) => (text += chunk), ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      this.cancelReact();
      this.marks = this.marks.filter((s) => !marks.includes(s));
      this.emit("error", { text: err.message || "Nie udało się odpowiedzieć." });
      return;
    }
    if (ctrl.signal.aborted) return;
    this.gFx.textContent = "";
    this.marks = this.marks.filter((s) => !marks.includes(s));
    this.pending = "";
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && l !== "done");
    const err = lines.find((l) => l.startsWith("error "));
    if (err) this.emit("error", { text: err.slice(6) });
    const body = lines.filter((l) => !l.startsWith("error "));
    if (!body.length || body[0].toLowerCase() === "nothing") {
      this.reacting = null;
      this.reactCtrl = null;
      this.emit("state");
      return;
    }
    this.reacting.placed = true;
    const entry = { text: body.join("\n"), anchor: box, region };
    this.placeReply(entry);
    this.log.push({ t: "reply", ...entry });
    this.script += `\n# The student marked the board${near.length ? " near " + near[0] : ""}. You replied:\n${entry.text}\n`;
    this.reacting = null;
    this.reactCtrl = null;
    this.emit("state");
    this.emit("change");
  }

  thinkingAt(box) {
    this.gFx.textContent = "";
    const g = el("g", { class: "bd-thinking", transform: `translate(${(box.x + box.w + 26).toFixed(0)} ${(box.y + box.h / 2).toFixed(0)})` });
    for (let i = 0; i < 3; i++) g.append(el("circle", { cx: i * 17, cy: 0, r: 5 }));
    this.gFx.append(g);
  }

  buildReply(lines, x, y, region) {
    const saved = { cur: this.cur, colY: this.colY.slice(), stepN: this.stepN, blocks: this.blocks.length, steps: this.steps.length, pending: this.pending, figs: new Map(this.figs) };
    const block = { kind: "reply", x, y, w: REPLY_W, cy: y };
    this.cur = { block, fig: null };
    this.overFig = region ? { id: "over", over: true, unit: region.w / 100, x: region.x, y: region.y, w: region.w, h: region.h, labels: [], ink: [], axes: null, block } : null;
    this.buildingLane = this.side;
    const items = [];
    let over = false;
    for (const line of lines) {
      const c = parseLine(line);
      if (!c || c.cmd === "step" || c.cmd === "title") continue;
      if (c.cmd === "over") over = true;
      const built = this.build(c);
      for (const it of built) {
        it.step = null;
        it.block = block;
        it.over = over;
      }
      items.push(...built);
    }
    let box = null;
    for (const it of items) if (!it.over && it.box) box = union(box, it.box);
    for (const [id, f] of this.figs) if (!saved.figs.has(id)) box = union(box, { x: f.x, y: f.y, w: f.w, h: f.h });
    const figs = this.figs;
    this.figs = saved.figs;
    this.cur = saved.cur;
    this.colY = saved.colY;
    this.stepN = saved.stepN;
    this.pending = saved.pending;
    this.overFig = null;
    return { items, box: box || { x, y, w: 10, h: 10 }, block, figs };
  }

  spot(w, h, anchor) {
    const taken = [];
    for (const lane of [this.main, this.side]) for (const it of lane.items) if (it.box && it.box.w * it.box.h > 0) taken.push(it.box);
    for (const f of this.figs.values()) if (!f.over) taken.push({ x: f.x, y: f.y, w: f.w, h: f.h });
    for (const s of this.user) taken.push(s.box);
    for (const r of this.replies) taken.push(r.box);
    const keep = grow(anchor, 44);
    const ax = anchor.x + anchor.w / 2, ay = anchor.y + anchor.h / 2;
    let best = null;
    for (let dx = -1500; dx <= 1500; dx += 50) {
      for (let dy = -1100; dy <= 1100; dy += 50) {
        const r = { x: ax + dx - w / 2, y: ay + dy - h / 2, w, h };
        if (hits(r, keep)) continue;
        const gx = Math.max(keep.x - (r.x + r.w), r.x - (keep.x + keep.w), 0), gy = Math.max(keep.y - (r.y + r.h), r.y - (keep.y + keep.h), 0);
        const score = Math.hypot(gx, gy) + (dx < 0 ? 90 : 0) + (dy < 0 ? 60 : 0) + Math.abs(dy) * 0.25;
        if (best && score >= best.score) continue;
        if (taken.some((t) => !anchorPart(t, anchor) && hits(r, t, 12))) continue;
        best = { score, x: r.x, y: r.y };
      }
    }
    return best || { x: anchor.x + anchor.w + 70, y: anchor.y };
    function anchorPart(t, a) {
      return t.x >= a.x - 1 && t.y >= a.y - 1 && t.x + t.w <= a.x + a.w + 1 && t.y + t.h <= a.y + a.h + 1;
    }
  }

  placeReply(entry, instant) {
    const lines = entry.text.split("\n");
    const seed = this.seed;
    let at = entry.at;
    if (!at) {
      const dry = this.buildReply(lines, 0, 0, null);
      at = this.spot(dry.box.w + 24, dry.box.h + 24, entry.anchor);
      at = { x: at.x + 12 - dry.box.x, y: at.y + 12 - dry.box.y };
      entry.at = at;
    }
    this.seed = seed;
    const real = this.buildReply(lines, at.x, at.y, entry.region);
    for (const [id, f] of real.figs) if (!this.figs.has(id)) this.figs.set("r" + this.replies.length + id, f);
    const r = this.rand();
    const a = entry.anchor, b = real.box;
    const from = edgePoint(grow(a, 12), b.x + b.w / 2, b.y + b.h / 2), to = edgePoint(grow(b, 16), a.x + a.w / 2, a.y + a.h / 2);
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const items = [];
    if (len > 30) {
      const nx = -(to[1] - from[1]) / len, ny = (to[0] - from[0]) / len, bend = Math.min(40, len * 0.16);
      const curve = wobbleCurve(r, [from, [(from[0] + to[0]) / 2 + nx * bend, (from[1] + to[1]) / 2 + ny * bend], to]);
      const arrow = this.item([this.pathPart(curve, { color: "blue", w: 3.4 }), this.pathPart(arrowHead(r, curve[curve.length - 3][0], curve[curve.length - 3][1], to[0], to[1], 17), { color: "blue", w: 3.4 })], { step: null, block: real.block, pause: 120 });
      items.push(arrow);
    }
    items.push(...real.items);
    if (items.length) items[0].reveal = union(grow(b, 6), a);
    this.replies.push({ box: grow(b, 8) });
    this.push(this.side, items);
    if (instant) for (const it of items) this.show(it, true);
    function edgePoint(box, tx, ty) {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return [cx, cy];
      const t = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
      return [cx + dx * t, cy + dy * t];
    }
  }


  async stream(body, onText, signal) {
    const res = await fetch(this.api + "/draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: this.app, debug: this.opts.debug, ...body }), signal });
    if (!res.ok) {
      let msg = "Tablica nie odpowiada. Spróbuj jeszcze raz.";
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (ev.startsWith("data: ")) {
          try {
            onText(JSON.parse(ev.slice(6)));
          } catch {}
        }
      }
    }
  }

  async run(kind, question) {
    if (this.ctrl) this.ctrl.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.streaming = true;
    this.busy = true;
    this.playing = true;
    this.follow = true;
    this.emit("state");
    const entry = { t: kind, q: question, text: "" };
    this.log.push(entry);
    this.live = entry;
    const reader = new LineReader((line) => {
      const c = parseLine(line);
      if (!c) return;
      if (c.cmd === "done") return;
      if (c.cmd === "error") return this.emit("error", { text: c.text });
      if (c.cmd === "title" && this.hasTitle) return;
      entry.text += line.trim() + "\n";
      this.buildingLane = this.main;
      const items = this.build(c);
      if (items.length) {
        if (this.busy) {
          this.busy = false;
          this.emit("state");
        }
        this.push(this.main, items);
      }
    });
    try {
      await this.stream({ kind, question, board: kind === "more" ? this.script : undefined, context: this.context }, (chunk) => reader.push(chunk), ctrl.signal);
      reader.end();
    } catch (err) {
      if (!ctrl.signal.aborted) this.emit("error", { text: err.message || "Nie udało się połączyć z tablicą." });
    }
    if (this.ctrl !== ctrl) return;
    this.live = null;
    this.closeBlock();
    this.script += (kind === "more" ? `\n# The student asked: ${question}\n` : "") + entry.text;
    this.streaming = false;
    this.busy = false;
    this.ctrl = null;
    this.emit("state");
    this.emit("change");
    if (this.atEnd) this.laneEnd(this.main);
    this.kick();
  }

  get hasLesson() {
    return !this.isIntro && this.main.items.length > 0;
  }

  greet(text) {
    this.isIntro = true;
    this.feed(text);
  }

  ask(question, o = {}) {
    this.reset();
    this.question = question;
    this.title = String(o.title || question).replace(/\s+/g, " ").trim();
    this.feed("title " + this.title);
    return this.run("lesson", question);
  }

  more(question) {
    if (!this.hasLesson) return this.ask(question);
    if (this.streaming) return Promise.resolve();
    this.addQuestion(question);
    return this.run("more", question);
  }

  addQuestion(question, instant) {
    const block = this.openBlock("question");
    const r = this.rand();
    const cx = block.x + 20, cy = block.y + 19;
    const ring = this.pathPart(wobbleEllipse(r, cx, cy, 18, 18), { color: "blue", w: 3.2 });
    const mark = this.textPart("?", cx, cy + 1, { size: SIZE.badge + 2, color: "blue", anchor: "middle", middle: true, quick: true, tilt: false });
    const t = this.textPart(question, block.x + INDENT, block.y, { size: SIZE.head, maxW: COL - INDENT - 10, color: "blue" });
    block.cy = block.y + Math.max(46, t.box.h + 8);
    const it = this.item([ring, mark, t], { step: this.stepN + 1, kind: "question", label: question, pause: 240, block });
    this.push(this.main, [it]);
    if (instant) this.show(it, true);
  }

  stop() {
    if (this.ctrl) this.ctrl.abort();
  }


  snapshot(region, o = {}) {
    const scale = Math.min(2, (o.maxSide || 1400) / Math.max(region.w, region.h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(region.w * scale);
    cv.height = Math.round(region.h * scale);
    const g = cv.getContext("2d");
    const cs = getComputedStyle(this.host);
    const col = (name) => cs.getPropertyValue(`--bd-${COLORS[name] || "ink"}`).trim() || "#222";
    g.fillStyle = o.background || (o.grid ? "#ffffff" : cs.getPropertyValue("--bd-board").trim() || "#ffffff");
    g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    g.lineCap = "round";
    g.lineJoin = "round";
    const flat = !!o.grid;
    const paint = (color) => (flat ? FLAT[COLORS[color] || "ink"] : col(color));
    for (const s of this.user) {
      if (s.tool !== "high" || (o.marks && o.marks.includes(s))) continue;
      g.globalAlpha = 0.4;
      g.strokeStyle = paint("yellow");
      g.lineWidth = s.w;
      g.stroke(new Path2D(s.d));
      g.globalAlpha = 1;
    }
    for (const lane of [this.main, this.side]) {
      for (const it of lane.items) {
        if (!it.shown || !it.box || !hits(it.box, region)) continue;
        for (const p of it.parts) {
          if (p.type === "path") {
            const path = new Path2D(p.d);
            if (p.fill) {
              g.globalAlpha = p.solid ? 1 : 0.2;
              g.fillStyle = paint(p.fill);
              g.fill(path);
              g.globalAlpha = 1;
            }
            g.strokeStyle = paint(p.color);
            g.lineWidth = p.w;
            g.setLineDash(p.dashed ? [11, 10] : []);
            g.stroke(path);
          } else {
            g.fillStyle = paint(p.color);
            for (const l of p.lines) {
              for (const run of l.parts) {
                if (run.bar) g.fillRect(l.x + run.x, p.top + l.base + run.dy - 1.4, run.w, 2.8);
                else {
                  g.font = `${this.weight} ${run.size}px ${this.hand}`;
                  g.fillText(run.str, l.x + run.x, p.top + l.base + run.dy);
                }
              }
            }
          }
        }
      }
    }
    g.setLineDash([]);
    for (const s of this.user) {
      const fresh = o.marks && o.marks.includes(s);
      if (s.tool === "high" && !fresh) continue;
      g.strokeStyle = fresh ? "#e6007e" : paint(s.color);
      g.globalAlpha = fresh && s.tool === "high" ? 0.55 : 1;
      g.lineWidth = fresh && s.tool !== "high" ? s.w + 1.5 : s.w;
      g.stroke(new Path2D(s.d));
      g.globalAlpha = 1;
    }
    if (o.grid) {
      const unit = region.w / 100;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.font = `600 ${Math.round(15 / Math.min(1, scale) * Math.min(1, scale))}px system-ui, sans-serif`;
      g.fillStyle = "#8a8f98";
      g.strokeStyle = "rgba(120,128,140,.28)";
      g.lineWidth = 1;
      for (let v = 10; v < 100; v += 10) {
        g.beginPath();
        g.moveTo(v * unit, 0);
        g.lineTo(v * unit, region.h);
        g.stroke();
        g.fillText(String(v), v * unit + 3, 15);
      }
      for (let v = 10; v * unit < region.h; v += 10) {
        g.beginPath();
        g.moveTo(0, v * unit);
        g.lineTo(region.w, v * unit);
        g.stroke();
        g.fillText(String(v), 3, v * unit - 4);
      }
    }
    return cv;
  }

  picture(maxSide = 2000) {
    const all = this.contentBox(true);
    if (!all) return null;
    return this.snapshot(grow(all, 50), { maxSide });
  }


  serialize() {
    return { v: 1, question: this.question, title: this.title, cols: this.cols, log: this.log.map((e) => ({ ...e })), user: this.user.map((s) => ({ pts: s.pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), color: s.color, w: s.w, tool: s.tool })) };
  }

  load(data) {
    const keep = this.opts.cols;
    this.opts.cols = data.cols || 1;
    this.reset();
    this.opts.cols = keep;
    this.question = data.question || "";
    this.title = data.title || this.question;
    if (this.title) this.feed("title " + this.title);
    for (const e of data.log || []) {
      if (e.t === "reply") continue;
      if (e.t === "more") this.addQuestion(e.q, true);
      this.feed(e.text);
      this.closeBlock();
      this.script += (e.t === "more" ? `\n# The student asked: ${e.q}\n` : "") + e.text;
      this.log.push({ ...e });
    }
    for (const s of data.user || []) {
      const st = { ...s, pts: s.pts.map((p) => [p[0], p[1]]) };
      st.d = penPath(st.pts);
      st.box = grow(bounds(st.pts), st.w / 2);
      st.el = el("path", { class: st.tool === "high" ? "bd-user-high" : "bd-user-stroke", "stroke-width": st.w, d: st.d });
      st.el.style.stroke = ink(st.color);
      (st.tool === "high" ? this.gHigh : this.gUser).append(st.el);
      this.user.push(st);
    }
    for (const e of data.log || []) {
      if (e.t !== "reply") continue;
      const entry = { text: e.text, anchor: e.anchor, region: e.region, at: e.at };
      this.placeReply(entry, true);
      this.log.push({ t: "reply", ...entry });
      this.script += `\n# The student marked the board. You replied:\n${e.text}\n`;
    }
    this.pending = "";
    this.finishAll();
  }

  destroy() {
    if (this.ctrl) this.ctrl.abort();
    this.ctrl = null;
    if (this.reactCtrl) this.reactCtrl.abort();
    clearTimeout(this.markTimer);
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.svg.remove();
  }
}
