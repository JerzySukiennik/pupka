/* Spell checking on top of the Bloom dictionary: word test and correction suggestions. */

import { Bloom } from "./bloom.js";

const ALPHA = "aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźż";
const DIA = { a: "ą", c: "ć", e: "ę", l: "ł", n: "ń", o: "ó", s: "ś", z: "źż" };
const UNDIA = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

export class Speller {
  constructor(bloom) {
    this.bloom = bloom;
    this.user = new Set();
    this.ignored = new Set();
    this.freq = new Map();
  }

  static from(buffer, freqText) {
    const sp = new Speller(Bloom.fromBuffer(buffer));
    if (freqText) sp.setFreq(freqText);
    return sp;
  }

  setFreq(text) {
    this.freq = new Map();
    String(text).split("\n").forEach((w, i) => { w = w.trim(); if (w && !this.freq.has(w)) this.freq.set(w, i); });
  }

  bonus(w) {
    const r = this.freq.get(w);
    return r == null ? 0 : 0.9 * (1 - Math.log(r + 1) / Math.log(this.freq.size + 1));
  }

  setUserWords(list) { this.user = new Set(Array.from(list || [], (w) => String(w).toLowerCase())); }
  ignore(word) { this.ignored.add(word.toLowerCase()); }

  ok(word) {
    const w = word.toLowerCase();
    return this.user.has(w) || this.ignored.has(w) || this.bloom.has(w);
  }

  valid(w) { return this.bloom.has(w) || this.user.has(w); }

  diacriticVariants(w, cap = 600) {
    const slots = [];
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      if (DIA[c]) slots.push([i, [c, ...DIA[c]]]);
      else if (UNDIA[c]) slots.push([i, [c, UNDIA[c]]]);
      if (slots.length >= 9) break;
    }
    let combos = [{ s: w.split(""), changes: 0 }];
    for (const [i, opts] of slots) {
      const next = [];
      for (const base of combos) {
        for (const o of opts) {
          const s = base.s.slice(); s[i] = o;
          next.push({ s, changes: base.changes + (o === w[i] ? 0 : 1) });
          if (next.length > cap) break;
        }
        if (next.length > cap) break;
      }
      combos = next;
    }
    return combos.filter((c) => c.changes > 0).map((c) => ({ word: c.s.join(""), changes: c.changes }));
  }

  edits1(w) {
    const out = [];
    for (let i = 0; i < w.length; i++) out.push([w.slice(0, i) + w.slice(i + 1), 1.1]);
    for (let i = 0; i < w.length - 1; i++) out.push([w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 1]);
    for (let i = 0; i < w.length; i++) for (const c of ALPHA) if (c !== w[i]) out.push([w.slice(0, i) + c + w.slice(i + 1), 1.2]);
    for (let i = 0; i <= w.length; i++) for (const c of ALPHA) out.push([w.slice(0, i) + c + w.slice(i), 1.3]);
    return out;
  }

  suggest(raw, limit = 5) {
    const lower = raw.toLowerCase();
    if (lower.length < 2 || lower.length > 28) return [];
    const found = new Map();
    const put = (cand, score) => { if (cand !== lower && this.valid(cand) && (!found.has(cand) || found.get(cand) > score)) found.set(cand, score); };
    for (const d of this.diacriticVariants(lower)) put(d.word, 0.4 * d.changes);
    const e1 = this.edits1(lower);
    for (const [cand, sc] of e1) put(cand, sc);
    const strict = this.freq.size > 0;
    if (found.size < limit) {
      for (const [cand] of e1) {
        if (cand.length < 3 || cand.length > 24) continue;
        for (const d of this.diacriticVariants(cand, 40)) if (!strict || this.freq.has(d.word)) put(d.word, 1.6 + 0.4 * d.changes);
      }
    }
    if (found.size < 2 && lower.length >= 5 && lower.length <= 14) {
      const seen = new Set();
      for (const [cand] of e1) {
        if (cand.length < 4) continue;
        for (const [c2, sc] of this.edits1(cand)) {
          if (seen.has(c2)) continue;
          seen.add(c2);
          if (this.valid(c2) && c2 !== lower && (!strict || this.freq.has(c2))) {
            let pre = 0; while (pre < c2.length && pre < lower.length && c2[pre] === lower[pre]) pre++;
            let suf = 0; while (suf < c2.length && suf < lower.length && c2[c2.length - 1 - suf] === lower[lower.length - 1 - suf]) suf++;
            if (pre >= 2 && suf >= 2 && pre + suf >= Math.min(lower.length, c2.length) - 2) put(c2, 3 + (lower.length - pre - suf) * 0.3);
          }
        }
      }
    }
    if (this.freq.size && lower.length >= 4 && lower.length <= 24) {
      const single = new Set(["w", "z", "i", "o", "u", "a"]);
      for (let i = 1; i < lower.length; i++) {
        const l = lower.slice(0, i), r = lower.slice(i);
        if ((l.length >= 2 || single.has(l)) && r.length >= 2 && (this.freq.has(l) || single.has(l)) && this.freq.has(r) && this.valid(r) && (this.valid(l) || single.has(l))) {
          const key = l + " " + r;
          const sc = 1.2 - (this.bonus(l) + this.bonus(r)) / 2;
          if (!found.has(key) || found.get(key) > sc) found.set(key, sc);
        }
      }
    }
    const ranked = Array.from(found.entries()).map(([w, sc]) => {
      let adj = w.includes(" ") ? sc : sc - this.bonus(w);
      if ((UNDIA[w[0]] || w[0]) !== (UNDIA[lower[0]] || lower[0])) adj += 0.35;
      adj += Math.abs(w.length - lower.length) * 0.05;
      return [w, adj];
    }).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "pl"));
    return ranked.slice(0, limit).map(([w]) => matchCase(w, raw));
  }
}

export function matchCase(w, original) {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) return w.toUpperCase();
  if (original[0] !== original[0].toLowerCase()) return w[0].toUpperCase() + w.slice(1);
  return w;
}

export const WORD_CHUNK = /[^\s]+/gu;

export function wordsIn(text) {
  const out = [];
  let m;
  const re = /[^\s\u0000]+/gu;
  while ((m = re.exec(text))) {
    const chunk = m[0];
    if (/[\p{N}@#/\\:_=<>{}[\]|^~*$%&+]/u.test(chunk) || /^https?|www\./i.test(chunk)) continue;
    const parts = /[\p{L}\p{M}]+(?:['’‐-][\p{L}\p{M}]+)*/gu;
    let w;
    while ((w = parts.exec(chunk))) {
      const start = m.index + w.index, word = w[0];
      out.push({ word, from: start, to: start + word.length, chunkStart: m.index, afterSentence: false });
    }
  }
  return out;
}
