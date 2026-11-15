/* Parser for the board language: one command per line, numbers, "quoted labels" and trailing modifier words. */

export const TEXT_COMMANDS = new Set(["title", "step", "say", "note", "key", "wrong", "ask", "error"]);
export const BARE_COMMANDS = new Set(["reply", "over", "nothing", "done"]);
export const DRAW_COMMANDS = new Set(["fig", "line", "arrow", "circle", "ellipse", "rect", "poly", "polyline", "curve", "arc", "hatch", "text", "dot", "dim", "angle", "badge", "axes", "plot", "pt", "seg"]);
const COLORS = new Set(["black", "red", "blue", "green", "orange", "purple", "gray", "grey"]);
const FLAGS = new Set(["dashed", "thick", "thin", "fill", "big", "small", "arrow", "left", "right"]);

export function parseLine(raw) {
  const line = raw.replace(/\s+$/, "").replace(/^\s+/, "");
  if (!line || line.startsWith("```") || line.startsWith("#") || /^plan\b/i.test(line)) return null;
  const space = line.indexOf(" ");
  const cmd = (space < 0 ? line : line.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : line.slice(space + 1).trim();

  if (TEXT_COMMANDS.has(cmd)) return rest ? { cmd, text: rest } : null;
  if (BARE_COMMANDS.has(cmd)) return { cmd };
  if (!DRAW_COMMANDS.has(cmd)) return null;

  if (cmd === "plot") {
    const words = rest.split(/\s+/);
    const mods = {};
    while (words.length > 1) {
      const w = words[words.length - 1].toLowerCase();
      if (COLORS.has(w)) mods.color = w === "grey" ? "gray" : w;
      else if (FLAGS.has(w)) mods[w] = true;
      else break;
      words.pop();
    }
    return { cmd, expr: words.join(" "), nums: [], strs: [], mods };
  }

  const nums = [], strs = [], mods = {}, words = [];
  const re = /"([^"]*)"|“([^”]*)”|(\S+)/g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1] !== undefined || m[2] !== undefined) { strs.push(m[1] !== undefined ? m[1] : m[2]); continue; }
    const tok = m[3];
    const low = tok.toLowerCase();
    if (/^[-+−]?(\d+([.,]\d+)?|[.,]\d+)$/.test(tok)) nums.push(parseFloat(tok.replace("−", "-").replace(",", ".")));
    else if (COLORS.has(low)) mods.color = low === "grey" ? "gray" : low;
    else if (FLAGS.has(low)) mods[low] = true;
    else words.push(tok);
  }
  return { cmd, nums, strs, mods, words };
}

export class LineReader {
  constructor(onLine) {
    this.buf = "";
    this.onLine = onLine;
  }
  push(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      this.onLine(line);
    }
  }
  end() {
    if (this.buf.trim()) this.onLine(this.buf);
    this.buf = "";
  }
}
