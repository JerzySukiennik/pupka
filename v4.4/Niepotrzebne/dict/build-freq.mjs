/* Build dist/pl-freq.txt: the most frequent Polish words (rank order), restricted to words the dictionary accepts. */
import fs from "node:fs";
import { Bloom } from "../../src/bloom.js";
const bloom = Bloom.fromBuffer(fs.readFileSync("../../dist/pl.bloom"));
const out = [];
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  const w = line.split(" ")[0].trim().toLowerCase();
  if (w.length >= 2 && /^[\p{L}]+$/u.test(w) && bloom.has(w)) out.push(w);
}
fs.writeFileSync("../../dist/pl-freq.txt", out.join("\n"));
console.log("freq words", out.length, "KB", Math.round(out.join("\n").length / 1024));
