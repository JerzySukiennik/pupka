/* Bloom filter shared by the dictionary builder (Node) and the browser spell checker.
   File layout: "PLB1" magic, uint32 bit count, uint32 hash count, then the bit array (uint32 words, little endian). */

export const MAGIC = 0x31424c50;

export function hashes(word) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b); h1 ^= h1 >>> 13;
  h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35); h2 ^= h2 >>> 16;
  return [h1 >>> 0, (h2 | 1) >>> 0];
}

export class Bloom {
  constructor(bits, k, words) {
    this.bits = bits;
    this.k = k;
    this.words = words || new Uint32Array(Math.ceil(bits / 32));
  }
  add(word) {
    const [a, b] = hashes(word);
    for (let i = 0; i < this.k; i++) {
      const idx = (a + Math.imul(i, b)) >>> 0;
      const bit = idx % this.bits;
      this.words[bit >>> 5] |= 1 << (bit & 31);
    }
  }
  has(word) {
    const [a, b] = hashes(word);
    for (let i = 0; i < this.k; i++) {
      const idx = (a + Math.imul(i, b)) >>> 0;
      const bit = idx % this.bits;
      if (!(this.words[bit >>> 5] & (1 << (bit & 31)))) return false;
    }
    return true;
  }
  toBuffer() {
    const out = new Uint8Array(12 + this.words.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC, true); dv.setUint32(4, this.bits, true); dv.setUint32(8, this.k, true);
    out.set(new Uint8Array(this.words.buffer, this.words.byteOffset, this.words.byteLength), 12);
    return out;
  }
  static fromBuffer(buf) {
    const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error("bad dictionary file");
    const bits = dv.getUint32(4, true), k = dv.getUint32(8, true);
    return new Bloom(bits, k, new Uint32Array(ab.slice(12)));
  }
}
