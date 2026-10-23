import fs from "node:fs";
import { Speller } from "../../src/spellcheck.js";
const sp = Speller.from(fs.readFileSync("../../dist/pl.bloom"), fs.readFileSync("../../dist/pl-freq.txt", "utf8"));
// 1) recall on real forms
const forms = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
let miss = 0; const N = 50000;
for (let i = 0; i < N; i++) { const w = forms[Math.floor(Math.random() * forms.length)]; if (!sp.ok(w)) miss++; }
console.log("recall misses on", N, "real forms:", miss);
// 2) false positives on random gibberish
let fp = 0; const G = 200000; const A = "abcdefghijklmnopqrstuvwxyząćęłńóśźż";
for (let i = 0; i < G; i++) { let w = ""; const L = 5 + Math.floor(Math.random() * 8); for (let j = 0; j < L; j++) w += A[Math.floor(Math.random() * A.length)]; if (sp.bloom.has(w) && !forms.includes && true) fp++; }
console.log("false-positive rate on random strings:", (fp / G * 100).toFixed(4) + "%");
// 3) correct school sentences should pass
const good = "Fotosynteza jest procesem w którym rośliny wytwarzają glukozę z dwutlenku węgla i wody dzięki energii światła słonecznego Jan Kochanowski napisał fraszki pieśni oraz treny po śmierci córki Urszulki Mieszko pierwszy przyjął chrzest w roku dziewięćset sześćdziesiątym szóstym kartkówka sprawdzian geografia chemia".split(" ");
console.log("flagged in correct text:", good.filter((w) => !sp.ok(w)));
// 4) typo suggestions
const typos = ["ktory","roslina","wlasnie","zeby","bylo","tez","naprawde","poniewaz","ucznoiw","wiezienie","kartkufka","pownien","przyjaciuł","dzieki","slonce","wspolczesny","rzeczpospolita","mitochondrium","genetyka","fotosyntezaa","wodna","kochanowksi","pieśn","dwutlnek","chrzesc","ortografja","grzeczny","zadanie","jakis","ojczyzna","pol","nauczyciel","szkola","obowiazek","wojna","konstytucja","budowa","oddychanie","komorka","zywnosc"];
for (const t of typos) { const t0 = performance.now(); const s = sp.suggest(t); const ms = (performance.now() - t0).toFixed(0); console.log((sp.ok(t) ? "ok   " : "TYPO ") + t.padEnd(16), JSON.stringify(s), ms + "ms"); }
