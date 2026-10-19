/* Custom TipTap pieces: block ids for drawing anchors, KaTeX math, callouts, test header, resizable images, extra markdown shortcuts. */

import { Node, Extension, mergeAttributes, InputRule, wrappingInputRule, Plugin, PluginKey, katex, Image, NodeSelection } from "../lib/vendor.js";
import { uid } from "./store.js";
import { icon } from "./icons.js";

export const BLOCK_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "table", "image", "callout", "testHeader", "spacer"];

export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        bid: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-bid"),
          renderHTML: (attrs) => attrs.bid ? { "data-bid": attrs.bid } : {}
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("blockId"),
      appendTransaction: (trs, oldState, newState) => {
        if (!trs.some((t) => t.docChanged)) return null;
        const seen = new Set();
        let tr = null;
        newState.doc.forEach((node, pos) => {
          if (!node.type.spec.attrs || !("bid" in node.type.spec.attrs)) return;
          let bid = node.attrs.bid;
          if (!bid || seen.has(bid)) {
            bid = uid();
            tr = (tr || newState.tr).setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { bid }));
          }
          seen.add(bid);
        });
        return tr;
      }
    })];
  }
});

let mathPop = null;
export function closeMathPopover() { if (mathPop) { mathPop.remove(); mathPop = null; } }

export function openMathPopover(editor, anchorRect, latex, onCommit) {
  closeMathPopover();
  const pop = document.createElement("div");
  pop.className = "math-pop";
  pop.innerHTML = `<input class="math-input" placeholder="np. \\frac{a}{b}, x^2, \\sqrt{2}, H_2O" spellcheck="false"><div class="math-preview"></div><div class="math-hint">Enter zapisuje, Esc zamyka, puste usuwa</div>`;
  document.body.appendChild(pop);
  const input = pop.querySelector("input");
  const prev = pop.querySelector(".math-preview");
  input.value = latex || "";
  const render = () => { try { katex.render(input.value || "\\;", prev, { throwOnError: false, displayMode: false }); } catch (e) { prev.textContent = input.value; } };
  render();
  input.addEventListener("input", render);
  const place = () => {
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = anchorRect.left, y = anchorRect.bottom + 8;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    if (y + h > window.innerHeight - 8) y = anchorRect.top - h - 8;
    pop.style.left = Math.max(8, x) + "px"; pop.style.top = Math.max(8, y) + "px";
  };
  place();
  input.focus();
  input.select();
  const finish = (commit) => {
    if (!mathPop) return;
    const v = input.value.trim();
    closeMathPopover();
    if (commit) onCommit(v);
    editor.commands.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => setTimeout(() => finish(true), 120));
  mathPop = pop;
}

export const MathNode = Node.create({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "", parseHTML: (el) => el.getAttribute("data-latex") || el.textContent, renderHTML: (a) => ({ "data-latex": a.latex }) } };
  },
  parseHTML() { return [{ tag: "span[data-latex]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "math" }), HTMLAttributes["data-latex"]]; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("span");
      dom.className = "math";
      let cur = node;
      const render = (latex) => { try { katex.render(latex || "\\;", dom, { throwOnError: false }); } catch (e) { dom.textContent = latex; } };
      render(node.attrs.latex);
      dom.addEventListener("mousedown", (e) => {
        if (!editor.isEditable) return;
        e.preventDefault();
        const pos = getPos();
        openMathPopover(editor, dom.getBoundingClientRect(), cur.attrs.latex, (v) => {
          const tr = editor.state.tr;
          if (!v) tr.delete(pos, pos + 1);
          else tr.setNodeMarkup(pos, undefined, { latex: v });
          editor.view.dispatch(tr);
        });
      });
      return {
        dom,
        update: (n) => { if (n.type.name !== "math") return false; cur = n; render(n.attrs.latex); return true; },
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected")
      };
    };
  },
  addInputRules() {
    const type = this.type;
    return [new InputRule({
      find: /\$([^$\s][^$]*?)\$$/,
      handler: ({ state, range, match }) => {
        const { from, to } = range;
        if (from < 0 || to > state.doc.content.size || state.doc.textBetween(from, to, "￼", "￼") !== match[0].slice(0, -1)) return null;
        state.tr.replaceWith(from, to, type.create({ latex: match[1].trim() }));
      }
    })];
  },
  addCommands() {
    return {
      promptMath: () => ({ editor }) => {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        openMathPopover(editor, { left: coords.left, top: coords.top, bottom: coords.bottom }, "", (v) => { if (v) editor.chain().focus().insertContent({ type: "math", attrs: { latex: v } }).run(); });
        return true;
      }
    };
  }
});

export const KINDS = { definicja: "Definicja", wazne: "Ważne", wzor: "Wzór" };

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "wazne", parseHTML: (el) => el.getAttribute("data-callout") || "wazne", renderHTML: (a) => ({ "data-callout": a.kind }) } };
  },
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "callout" }), 0]; },
  addInputRules() {
    return [wrappingInputRule({ find: /^!([dwzDWZ])\s$/, type: this.type, getAttributes: (m) => ({ kind: { d: "definicja", w: "wazne", z: "wzor" }[m[1].toLowerCase()] }) })];
  },
  addCommands() {
    return {
      toggleCallout: (kind) => ({ commands, editor }) => {
        if (editor.isActive("callout", { kind })) return commands.lift("callout");
        if (editor.isActive("callout")) return commands.updateAttributes("callout", { kind });
        return commands.wrapIn("callout", { kind });
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.depth < 2) return false;
        const parent = $from.node(-1);
        if (parent.type.name !== "callout") return false;
        const block = $from.parent;
        if (block.content.size !== 0 || $from.index(-1) !== parent.childCount - 1 || parent.childCount < 2) return false;
        return editor.commands.lift("callout");
      }
    };
  }
});


export const Spacer = Node.create({
  name: "spacer",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { h: { default: 240, parseHTML: (el) => parseInt(el.getAttribute("data-h"), 10) || 240, renderHTML: (a) => ({ "data-h": a.h }) } };
  },
  parseHTML() { return [{ tag: "div[data-spacer]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-spacer": "", class: "draw-spacer" })]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "draw-spacer";
      dom.contentEditable = "false";
      const set = (n) => { dom.style.height = n.attrs.h + "px"; if (n.attrs.bid) dom.dataset.bid = n.attrs.bid; };
      set(node);
      return { dom, update: (n) => { if (n.type.name !== "spacer") return false; set(n); return true; }, ignoreMutation: () => true, selectNode: () => dom.classList.add("selected"), deselectNode: () => dom.classList.remove("selected") };
    };
  }
});

export const TestHeader = Node.create({
  name: "testHeader",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { owner: { default: "" }, fullName: { default: "" }, cls: { default: "" }, date: { default: "" }, name: { default: "" }, kind: { default: "kartkówka" } };
  },
  parseHTML() { return [{ tag: "div[data-test-header]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-test-header": "", class: "test-header" })]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "test-header";
      dom.contentEditable = "false";
      const build = (n) => {
        const a = n.attrs;
        dom.innerHTML = `<div class="th-row"><span class="th-name">${escapeHtml(a.fullName || a.owner)}</span><span class="th-cls">${escapeHtml(a.cls)}</span><span class="th-date">${escapeHtml(a.date)}</span></div><div class="th-title">${escapeHtml(a.kind)}${a.name ? ": " + escapeHtml(a.name) : ""}</div>`;
      };
      build(node);
      return { dom, update: (n) => { if (n.type.name !== "testHeader") return false; build(n); return true; }, ignoreMutation: () => true };
    };
  }
});

function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

export const ResizableImage = Image.extend({
  draggable: false,
  addAttributes() {
    return Object.assign({}, this.parent?.(), {
      width: { default: null, parseHTML: (el) => el.getAttribute("width") || null, renderHTML: (a) => a.width ? { width: a.width } : {} },
      align: { default: "center", parseHTML: (el) => el.getAttribute("data-align") || "center", renderHTML: (a) => ({ "data-align": a.align }) },
      fx: { default: 0, parseHTML: (el) => parseFloat(el.getAttribute("data-fx")) || 0, renderHTML: (a) => a.align === "free" ? { "data-fx": a.fx } : {} },
      fy: { default: 0, parseHTML: (el) => parseFloat(el.getAttribute("data-fy")) || 0, renderHTML: (a) => a.align === "free" ? { "data-fy": a.fy } : {} }
    });
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      const dom = document.createElement("figure");
      dom.className = "img-figure";
      const box = document.createElement("div");
      box.className = "img-box";
      const img = document.createElement("img");
      img.draggable = false;
      const cap = document.createElement("figcaption");
      cap.setAttribute("data-placeholder", "podpis (opcjonalnie)");
      const handle = document.createElement("div");
      handle.className = "img-handle";
      const bar = document.createElement("div");
      bar.className = "img-bar";
      bar.innerHTML = `<button data-al="left" title="Do lewej, tekst obok">${icon("alignLeft", 14)}</button><button data-al="center" title="W tekście, na środku">${icon("alignCenter", 14)}</button><button data-al="right" title="Do prawej, tekst obok">${icon("alignRight", 14)}</button><button data-al="free" title="Wolno: przeciągnij gdziekolwiek">${icon("move", 14)}</button><button data-del title="Usuń obrazek">${icon("trash", 14)}</button>`;
      box.append(img, cap, handle, bar);
      dom.append(box);

      const apply = (n) => {
        const a = n.attrs;
        img.src = a.src;
        img.alt = a.alt || "";
        img.style.width = a.width ? a.width + "px" : "";
        dom.dataset.align = a.align || "center";
        if (a.bid) dom.dataset.bid = a.bid;
        if (a.align === "free") { box.style.left = (a.fx || 0) + "px"; box.style.top = (a.fy || 0) + "px"; }
        else { box.style.left = ""; box.style.top = ""; }
        bar.querySelectorAll("[data-al]").forEach((b) => b.classList.toggle("on", b.dataset.al === (a.align || "center")));
        if (document.activeElement !== cap) cap.textContent = a.alt || "";
      };
      apply(node);

      const setAttrs = (patch) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const n = editor.state.doc.nodeAt(pos);
        if (!n) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, n.attrs, patch)));
      };
      const pmRect = () => editor.view.dom.getBoundingClientRect();
      const select = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      };

      cap.contentEditable = editor.isEditable ? "true" : "false";
      cap.addEventListener("blur", () => { const v = cap.textContent.trim(); if (v !== (cur.attrs.alt || "")) setAttrs({ alt: v }); });
      cap.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); cap.blur(); editor.commands.focus(); } });

      bar.addEventListener("mousedown", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        e.preventDefault();
        if (b.dataset.al === "free") {
          const br = box.getBoundingClientRect(), pr = pmRect();
          setAttrs({ align: "free", fx: Math.max(0, Math.round(br.left - pr.left)), fy: 0, width: cur.attrs.width || Math.round(img.getBoundingClientRect().width) });
        } else if (b.dataset.al) setAttrs({ align: b.dataset.al, fx: 0, fy: 0 });
        else if (b.hasAttribute("data-del")) { const pos = getPos(); editor.view.dispatch(editor.state.tr.delete(pos, pos + 1)); }
      });

      handle.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable) return;
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX, startW = img.getBoundingClientRect().width;
        const maxW = Math.max(120, pmRect().width - (cur.attrs.align === "free" ? (cur.attrs.fx || 0) : 0));
        const dir = cur.attrs.align === "right" ? -1 : 1;
        let w = startW;
        const move = (ev) => { w = Math.max(60, Math.min(maxW, startW + (ev.clientX - startX) * dir)); img.style.width = w + "px"; dom.dispatchEvent(new CustomEvent("pupka-img", { bubbles: true })); };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setAttrs({ width: Math.round(w) }); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });

      img.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        select();
        const startX = e.clientX, startY = e.clientY;
        const br = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), pr0 = pmRect();
        const left0 = br.left - pr0.left, top0 = br.top - pr0.top;
        let dragging = false, ghost = null;
        const move = (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (!dragging) {
            if (Math.hypot(dx, dy) < 4) return;
            dragging = true;
            dom.classList.add("dragging");
            ghost = img.cloneNode();
            ghost.className = "img-ghost";
            ghost.style.cssText = `position:fixed;left:${ir.left}px;top:${ir.top}px;width:${ir.width}px;height:${ir.height}px;pointer-events:none;z-index:400;opacity:.8;border-radius:3px;box-shadow:0 10px 30px rgba(0,0,0,.35)`;
            document.body.appendChild(ghost);
          }
          ghost.style.left = ir.left + dx + "px";
          ghost.style.top = ir.top + dy + "px";
        };
        const up = (ev) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          if (ghost) ghost.remove();
          dom.classList.remove("dragging");
          if (!dragging) return;
          const pr = pmRect();
          const w = Math.round(ir.width);
          let nl = left0 + (ev.clientX - startX), nt = top0 + (ev.clientY - startY);
          nl = Math.max(0, Math.min(Math.max(0, pr.width - w), nl));
          const pos = getPos();
          if (typeof pos !== "number") return;
          const doc = editor.state.doc;
          const node = doc.nodeAt(pos);
          if (!node) return;
          const pm = editor.view.dom;
          let anchor = null, anchorTop = 0, first = null;
          doc.forEach((child, off, idx) => {
            if (off === pos) return;
            const el = pm.children[idx];
            if (!el) return;
            const top = el.getBoundingClientRect().top - pr.top;
            if (!first) first = { off, top };
            if (top <= nt + 1) { anchor = off; anchorTop = top; }
          });
          if (anchor == null && first) { anchor = first.off; anchorTop = first.top; }
          const attrs = Object.assign({}, node.attrs, { align: "free", fx: Math.round(nl), fy: Math.round(nt - anchorTop), width: w });
          const tr = editor.state.tr;
          tr.delete(pos, pos + node.nodeSize);
          const at = anchor == null ? tr.doc.content.size : tr.mapping.map(anchor);
          tr.insert(at, node.type.create(attrs));
          editor.view.dispatch(tr);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      });

      return {
        dom,
        update: (n) => { if (n.type.name !== "image") return false; cur = n; apply(n); return true; },
        stopEvent: (e) => cap.contains(e.target) || bar.contains(e.target) || handle.contains(e.target) || img.contains(e.target),
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected")
      };
    };
  }
});

function delimRule(find, markName) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const mark = state.schema.marks[markName];
      if (!mark) return null;
      const full = match[0], outer = match[1], inner = match[2];
      const from = range.from + (full.length - outer.length), to = range.to;
      if (from < 0 || from >= to || to > state.doc.content.size) return null;
      if (state.doc.textBetween(from, to, "￼", "￼") !== outer.slice(0, -1)) return null;
      const tr = state.tr;
      tr.insertText(inner, from, to);
      tr.addMark(from, from + inner.length, mark.create());
      tr.removeStoredMark(mark);
    }
  });
}

export const Shortcuts = Extension.create({
  name: "shortcuts",
  priority: 1000,
  addInputRules() {
    const absorb = new InputRule({
      find: /^(\d+[.)]|[-*•])\s$/,
      handler: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.depth < 2 || $from.node($from.depth - 1).type.name !== "listItem" || $from.parent.type.name !== "paragraph") return null;
        if ($from.parent.content.size !== 0 && $from.parentOffset !== 0) return null;
        state.tr.delete(range.from, range.to);
      }
    });
    return [
      absorb,
      delimRule(/(?:^|\s)(__([^_\n]+)__)$/, "underline"),
      delimRule(/(\^([^^\s][^^\n]*?)\^)$/, "superscript"),
      delimRule(/(?:^|[^~])(~([^~\s][^~\n]*?)~)$/, "subscript")
    ];
  }
});
