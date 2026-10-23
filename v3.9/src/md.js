/* Markdown dialect used between the AI and the editor: parse to ProseMirror JSON, serialize doc to numbered blocks. */

const INLINE = /(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(~~([^~\n]+)~~)|(\*([^*\n]+)\*)|(\^([^^\n]+)\^)|(~([^~\n]+)~)|(`([^`\n]+)`)|(\$([^$\n]+)\$)|(!\[([^\]]*)\]\(([^)\s]+)\))/;

export function parseInline(text, marks = []) {
  const out = [];
  let rest = String(text || "");
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) { pushText(out, rest, marks); break; }
    if (m.index > 0) pushText(out, rest.slice(0, m.index), marks);
    if (m[1]) out.push(...parseInline(m[2], marks.concat([{ type: "bold" }])));
    else if (m[3]) out.push(...parseInline(m[4], marks.concat([{ type: "underline" }])));
    else if (m[5]) out.push(...parseInline(m[6], marks.concat([{ type: "strike" }])));
    else if (m[7]) out.push(...parseInline(m[8], marks.concat([{ type: "italic" }])));
    else if (m[9]) out.push(...parseInline(m[10], marks.concat([{ type: "superscript" }])));
    else if (m[11]) out.push(...parseInline(m[12], marks.concat([{ type: "subscript" }])));
    else if (m[13]) pushText(out, m[14], marks.concat([{ type: "code" }]));
    else if (m[15]) out.push({ type: "math", attrs: { latex: m[16].trim() } });
    else if (m[17]) out.push({ type: "image", attrs: { src: m[19], alt: m[18] || "" } });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function pushText(out, text, marks) {
  if (!text) return;
  const node = { type: "text", text };
  if (marks.length) node.marks = marks;
  out.push(node);
}

function para(text) {
  const content = parseInline(text);
  const imgs = content.filter((n) => n.type === "image");
  if (imgs.length && content.every((n) => n.type === "image" || (n.type === "text" && !n.text.trim()))) return imgs;
  return [{ type: "paragraph", content: content.filter((n) => n.type !== "image") }];
}

function parseList(lines, i, ordered, indent) {
  const items = [];
  const re = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*•]\s+(.*)$/;
  while (i < lines.length) {
    const m = re.exec(lines[i]);
    if (!m || m[1].length !== indent) break;
    const item = { type: "listItem", content: [{ type: "paragraph", content: parseInline(m[2]) }] };
    i++;
    while (i < lines.length) {
      const sub = /^(\s*)([-*•]|\d+[.)])\s+/.exec(lines[i]);
      if (!sub || sub[1].length <= indent) break;
      const subOrdered = /\d/.test(sub[2]);
      const r = parseList(lines, i, subOrdered, sub[1].length);
      item.content.push(r.node);
      i = r.i;
    }
    items.push(item);
  }
  return { node: { type: ordered ? "orderedList" : "bulletList", content: items }, i };
}

export function parseMarkdown(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { blocks.push({ type: "heading", attrs: { level: m[1].length }, content: parseInline(m[2]) }); i++; continue; }
    if (/^---+$/.test(line.trim())) { blocks.push({ type: "horizontalRule" }); i++; continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim()))) { blocks.push({ type: "image", attrs: { src: m[2], alt: m[1] } }); i++; continue; }
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: "codeBlock", content: buf.length ? [{ type: "text", text: buf.join("\n") }] : [] });
      continue;
    }
    if ((m = /^!([dwz])\s+(.*)$/.exec(line))) {
      const kind = { d: "definicja", w: "wazne", z: "wzor" }[m[1]];
      const paras = [];
      while (i < lines.length) {
        const mm = /^!([dwz])\s+(.*)$/.exec(lines[i]);
        if (!mm || mm[1] !== m[1]) break;
        paras.push(...para(mm[2]));
        i++;
      }
      blocks.push({ type: "callout", attrs: { kind }, content: paras.filter((p) => p.type === "paragraph") });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) { const r = parseList(lines, i, false, /^(\s*)/.exec(line)[1].length); blocks.push(r.node); i = r.i; continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const r = parseList(lines, i, true, /^(\s*)/.exec(line)[1].length); blocks.push(r.node); i = r.i; continue; }
    if (/^>\s?/.test(line)) {
      const paras = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { paras.push(...para(lines[i].replace(/^>\s?/, ""))); i++; }
      blocks.push({ type: "blockquote", content: paras.filter((p) => p.type === "paragraph") });
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({
        type: "table",
        content: rows.map((cells, ri) => ({
          type: "tableRow",
          content: Array.from({ length: width }, (_, ci) => ({ type: ri === 0 ? "tableHeader" : "tableCell", content: [{ type: "paragraph", content: parseInline(cells[ci] || "") }] }))
        }))
      });
      continue;
    }
    blocks.push(...para(line));
    i++;
  }
  return blocks;
}

function inlineToMd(node) {
  let out = "";
  node.forEach((child) => {
    if (child.type.name === "text") {
      let t = child.text;
      const names = child.marks.map((m) => m.type.name);
      if (names.includes("code")) t = "`" + t + "`";
      if (names.includes("bold")) t = "**" + t + "**";
      if (names.includes("italic")) t = "*" + t + "*";
      if (names.includes("underline")) t = "__" + t + "__";
      if (names.includes("strike")) t = "~~" + t + "~~";
      if (names.includes("superscript")) t = "^" + t + "^";
      if (names.includes("subscript")) t = "~" + t + "~";
      out += t;
    } else if (child.type.name === "math") out += "$" + child.attrs.latex + "$";
    else if (child.type.name === "hardBreak") out += "\n";
    else if (child.type.name === "image") out += `![${child.attrs.alt || ""}](${child.attrs.src})`;
    else if (child.isTextblock) out += inlineToMd(child);
    else if (child.content.size) out += inlineToMd(child);
  });
  return out;
}

export function blockToMd(node, indent = "") {
  const t = node.type.name;
  if (t === "paragraph") return indent + inlineToMd(node);
  if (t === "heading") return indent + "#".repeat(node.attrs.level) + " " + inlineToMd(node);
  if (t === "bulletList" || t === "orderedList") {
    const lines = [];
    node.forEach((item, _, idx) => {
      const marker = t === "orderedList" ? `${idx + 1}. ` : "- ";
      item.forEach((child, __, ci) => {
        if (ci === 0 && child.isTextblock) lines.push(indent + marker + inlineToMd(child));
        else if (child.type.name === "bulletList" || child.type.name === "orderedList") lines.push(blockToMd(child, indent + "  "));
        else lines.push(indent + "  " + blockToMd(child));
      });
    });
    return lines.join("\n");
  }
  if (t === "blockquote") { const l = []; node.forEach((c) => l.push("> " + blockToMd(c))); return l.join("\n"); }
  if (t === "callout") { const p = { definicja: "!d ", wazne: "!w ", wzor: "!z " }[node.attrs.kind] || "!w "; const l = []; node.forEach((c) => l.push(p + blockToMd(c))); return l.join("\n"); }
  if (t === "image") return `![${node.attrs.alt || ""}](${node.attrs.src})`;
  if (t === "codeBlock") return "```\n" + node.textContent + "\n```";
  if (t === "horizontalRule") return "---";
  if (t === "table") {
    const rows = [];
    node.forEach((row) => { const cells = []; row.forEach((cell) => cells.push(inlineToMd(cell).replace(/\n/g, " "))); rows.push("| " + cells.join(" | ") + " |"); });
    return rows.join("\n");
  }
  if (t === "spacer") return `(obszar rysunku, ${node.attrs.h} px)`;
  if (t === "testHeader") return `(nagłówek testu: ${node.attrs.fullName}, ${node.attrs.cls}, ${node.attrs.date}, ${node.attrs.name})`;
  return inlineToMd(node);
}

export function docToBlocks(doc) {
  const out = [];
  let n = 0;
  doc.forEach((node) => { n++; out.push(`[${n}] ${blockToMd(node)}`); });
  return out.join("\n");
}

export function docToPlain(doc, limit = 20000) {
  const parts = [];
  doc.forEach((node) => parts.push(node.textContent));
  return parts.join("\n").slice(0, limit);
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ESC[c]); }

export function mdToHtml(md) {
  const lines = String(md || "").split("\n");
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== "ul") { flush(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inlineHtml(m[1]) + "</li>"); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== "ol") { flush(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inlineHtml(m[1]) + "</li>"); continue; }
    flush();
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { out.push(`<h${m[1].length + 2}>${inlineHtml(m[2])}</h${m[1].length + 2}>`); continue; }
    out.push("<p>" + inlineHtml(line.replace(/^!([dwz])\s+/, "").replace(/^>\s?/, "")) + "</p>");
  }
  flush();
  return out.join("");
}

function inlineHtml(text) {
  let s = esc(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<u>$1</u>").replace(/\*([^*]+)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\^([^^]+)\^/g, "<sup>$1</sup>").replace(/(^|\s)~([^~]+)~/g, "$1<sub>$2</sub>");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  return s;
}
