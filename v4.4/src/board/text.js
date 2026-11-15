/* Handwritten text layout: measuring, wrapping, powers (x^2), indices (a_1) and stacked fractions ({a/b}). */

const ctx = document.createElement("canvas").getContext("2d");
const cache = new Map();

export function measure(str, size, family, weight) {
  const key = `${weight}|${size}|${family}|${str}`;
  let w = cache.get(key);
  if (w === undefined) {
    ctx.font = `${weight} ${size}px ${family}`;
    w = ctx.measureText(str).width;
    if (cache.size > 4000) cache.clear();
    cache.set(key, w);
  }
  return w;
}

function group(str, i) {
  if (str[i] === "{") {
    let depth = 0;
    for (let j = i; j < str.length; j++) {
      if (str[j] === "{") depth++;
      else if (str[j] === "}" && --depth === 0) return [str.slice(i + 1, j), j + 1];
    }
    return null;
  }
  const m = /^[-+−]?[0-9A-Za-zα-ωπ]+/.exec(str.slice(i));
  return m ? [m[0], i + m[0].length] : null;
}

function atoms(word) {
  const out = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ t: "txt", s: plain });
    plain = "";
  };
  let i = 0;
  while (i < word.length) {
    const c = word[i];
    if (c === "{") {
      const g = group(word, i);
      const slash = g ? g[0].indexOf("/") : -1;
      if (g && slash > 0 && slash < g[0].length - 1) {
        flush();
        out.push({ t: "frac", a: g[0].slice(0, slash), b: g[0].slice(slash + 1) });
        i = g[1];
        continue;
      }
    }
    if ((c === "^" || c === "_") && i > 0) {
      const g = group(word, i + 1);
      if (g) {
        flush();
        out.push({ t: c === "^" ? "sup" : "sub", s: g[0] });
        i = g[1];
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

function splitWords(str) {
  const words = [];
  let cur = "", depth = 0;
  for (const c of str) {
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (c === " " && depth === 0) {
      if (cur) words.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

function layWord(word, size, family, weight) {
  const parts = [];
  let x = 0, tall = false;
  for (const a of atoms(word)) {
    if (a.t === "txt") {
      parts.push({ str: a.s, x, dy: 0, size });
      x += measure(a.s, size, family, weight);
    } else if (a.t === "sup" || a.t === "sub") {
      const s = size * 0.62;
      parts.push({ str: a.s, x: x + 1, dy: a.t === "sup" ? -size * 0.36 : size * 0.16, size: s });
      x += measure(a.s, s, family, weight) + 2;
    } else {
      const s = size * 0.74;
      const wa = measure(a.a, s, family, weight), wb = measure(a.b, s, family, weight);
      const w = Math.max(wa, wb) + 10;
      parts.push({ str: a.a, x: x + 3 + (w - wa) / 2, dy: -size * 0.42, size: s });
      parts.push({ str: a.b, x: x + 3 + (w - wb) / 2, dy: size * 0.36, size: s });
      parts.push({ bar: true, x: x + 2, w: w + 2, dy: -size * 0.3 });
      x += w + 6;
      tall = true;
    }
  }
  return { parts, w: x, tall };
}

export function layout(str, size, family, weight, maxW = Infinity) {
  const space = measure(" ", size, family, weight) || size * 0.25;
  const lines = [];
  let line = { parts: [], w: 0, tall: false, chars: 0 };
  for (const word of splitWords(String(str))) {
    const lw = layWord(word, size, family, weight);
    const gap = line.parts.length ? space : 0;
    if (line.parts.length && line.w + gap + lw.w > maxW) {
      lines.push(line);
      line = { parts: [], w: 0, tall: false, chars: 0 };
    }
    const off = line.w + (line.parts.length ? space : 0);
    for (const p of lw.parts) line.parts.push({ ...p, x: p.x + off });
    line.w = off + lw.w;
    line.tall = line.tall || lw.tall;
    line.chars += word.length + 1;
  }
  if (line.parts.length) lines.push(line);
  let y = 0, w = 0;
  for (const l of lines) {
    l.h = size * (l.tall ? 1.7 : 1.16);
    l.base = y + (l.tall ? size * 1.12 : size * 0.86);
    l.y = y;
    y += l.h;
    if (l.w > w) w = l.w;
  }
  return { lines, w, h: y, size };
}
