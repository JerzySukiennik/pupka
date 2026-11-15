/* Safe compiler for one-variable formulas such as "2x^2 - 3" (no eval): returns a function of x, or null when the formula is not valid. */

const FUNCS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp };
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const out = [];
  const s = src.replace(/,/g, ".").replace(/[−–]/g, "-").replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/²/g, "^2").replace(/³/g, "^3");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      let word = s.slice(i, j).toLowerCase();
      i = j;
      while (word) {
        const name = Object.keys(FUNCS).concat(Object.keys(CONSTS), ["x"]).filter((k) => word.startsWith(k)).sort((a, b) => b.length - a.length)[0];
        if (!name) return null;
        out.push(name === "x" ? { t: "x" } : name in FUNCS ? { t: "fn", v: name } : { t: "num", v: CONSTS[name] });
        word = word.slice(name.length);
      }
      continue;
    }
    if ("+-*/^()".includes(c)) { out.push({ t: c }); i++; continue; }
    return null;
  }
  const full = [];
  for (let k = 0; k < out.length; k++) {
    const a = out[k - 1], b = out[k];
    if (a && (a.t === "num" || a.t === "x" || a.t === ")") && (b.t === "num" || b.t === "x" || b.t === "fn" || b.t === "(")) full.push({ t: "*" });
    full.push(b);
  }
  return full;
}

export function compile(src) {
  const body = String(src || "").replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, "");
  const toks = tokenize(body);
  if (!toks || !toks.length) return null;
  let pos = 0;
  const peek = () => toks[pos];
  const take = () => toks[pos++];

  function primary() {
    const t = take();
    if (!t) throw 0;
    if (t.t === "num") return () => t.v;
    if (t.t === "x") return (x) => x;
    if (t.t === "fn") {
      const fn = FUNCS[t.v];
      const arg = unary();
      return (x) => fn(arg(x));
    }
    if (t.t === "(") {
      const inner = sum();
      if (!peek() || take().t !== ")") throw 0;
      return inner;
    }
    throw 0;
  }
  function power() {
    const base = primary();
    if (peek() && peek().t === "^") {
      take();
      const exp = unary();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }
  function unary() {
    if (peek() && peek().t === "-") { take(); const v = unary(); return (x) => -v(x); }
    if (peek() && peek().t === "+") { take(); return unary(); }
    return power();
  }
  function product() {
    let left = unary();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = take().t, right = unary(), l = left;
      left = op === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = take().t, right = product(), l = left;
      left = op === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  }

  try {
    const fn = sum();
    if (pos !== toks.length) return null;
    return fn;
  } catch {
    return null;
  }
}
