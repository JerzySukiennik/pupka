/* Build dist/pl.bloom from the expanded Polish Hunspell forms (one lowercase word per line in forms.txt). */
import fs from "node:fs";
import { Bloom } from "../../src/bloom.js";

const forms = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const extra = fs.existsSync(new URL("./extra-words.txt", import.meta.url)) ? fs.readFileSync(new URL("./extra-words.txt", import.meta.url), "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean) : [];
const all = Array.from(new Set(forms.concat(extra)));
const bitsPerKey = 18, k = 12;
const bloom = new Bloom(all.length * bitsPerKey, k);
for (const w of all) bloom.add(w);
fs.writeFileSync(process.argv[3], bloom.toBuffer());
console.log("words", all.length, "bits", bloom.bits, "MB", (bloom.words.byteLength / 1048576).toFixed(2));
