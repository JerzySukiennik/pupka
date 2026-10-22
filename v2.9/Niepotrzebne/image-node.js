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
        const move = (ev) => { w = Math.max(60, Math.min(maxW, startW + (ev.clientX - startX) * dir)); img.style.width = w + "px"; };
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
