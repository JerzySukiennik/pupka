/* Built-in timetable of class VIII K (from the paper plan, permanent) and "what is now" with choices for split groups and breaks. */

import { listSubjects } from "./store.js";

export const SLOTS = [["7:45", "8:30"], ["8:30", "9:15"], ["9:15", "10:00"], ["10:30", "11:15"], ["11:25", "12:10"], ["12:30", "13:15"], ["13:35", "14:20"], ["14:25", "15:10"], ["15:10", "16:00"]];
export const DAY_NAMES = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek"];

const MAT = "Matematyka", HIS = "J. Hiszpański", POL = "J. Polski", ANG = "J. Angielski", KON = "Konwersacje", INF = "Informatyka";
export const WEEK = {
  1: [[], [MAT, HIS], [MAT, HIS], [KON, MAT], ["Fizyka"], ["Fizyka"], ["Historia"], ["Biologia"], []],
  2: [[], ["WF"], ["WF"], [POL], [POL], ["WOS"], ["Historia"], ["Godzina wychowawcza"], ["Testy z matematyki"]],
  3: [[], [HIS, MAT], [HIS, MAT], [ANG], [ANG], [MAT, "EDB"], ["WOS"], [POL], ["Testy z j. polskiego"]],
  4: [[], ["Geografia"], ["Geografia"], ["Chemia"], ["Chemia"], ["EDB", MAT], [ANG], [ANG], []],
  5: [[], [POL], [POL], [ANG], [INF, MAT], [MAT, INF], [MAT, KON], ["Hala na Polnej"], ["Hala na Polnej"]]
};
const SUBJECT_FOR = { "Testy z matematyki": MAT, "Testy z j. polskiego": POL };

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const mins = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

function resolve(label) {
  const want = norm(SUBJECT_FOR[label] || label);
  const sub = listSubjects().find((s) => norm(s.name) === want) || null;
  return { label, sub };
}

export function lessonsOn(day) {
  return (WEEK[day] || []).map((opts, i) => ({ i, start: SLOTS[i][0], end: SLOTS[i][1], options: opts.map(resolve) })).filter((l) => l.options.length);
}

export function lessonNow(date = new Date()) {
  const day = date.getDay();
  const list = lessonsOn(day);
  if (!list.length) return null;
  const t = date.getHours() * 60 + date.getMinutes();
  const out = [];
  const add = (l, when) => { for (const o of l.options) if (!out.some((x) => x.label === o.label)) out.push(Object.assign({ when, slot: l.i, start: l.start, end: l.end }, o)); };
  const curIdx = list.findIndex((l) => t >= mins(l.start) && t < mins(l.end));
  let slot = null;
  if (curIdx >= 0) {
    const cur = list[curIdx], prev = list[curIdx - 1];
    slot = cur;
    add(cur, "teraz");
    if (prev && t - mins(cur.start) <= 15 && mins(cur.start) - mins(prev.end) <= 25) add(prev, "przed chwilą");
  } else {
    const nextIdx = list.findIndex((l) => mins(l.start) > t);
    const prev = nextIdx > 0 ? list[nextIdx - 1] : nextIdx === -1 ? list[list.length - 1] : null;
    const next = nextIdx >= 0 ? list[nextIdx] : null;
    if (prev && next) { slot = next; add(prev, "przed chwilą"); add(next, "zaraz"); }
    else if (next && mins(next.start) - t <= 45) { slot = next; add(next, "zaraz"); }
    else if (prev && t - mins(prev.end) <= 45) { slot = prev; add(prev, "przed chwilą"); }
  }
  return out.length ? { day, slot, choices: out } : null;
}

export function sameOptions(a, b) { return a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i].label); }
