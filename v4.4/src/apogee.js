/* Connector for the Apogee browser: its agent reads and adds notes through window.pupka instead of clicking the editor. */
import { Y } from "../lib/vendor.js";
import { state, me, NAMES, users, listSubjects, listCards, card, subject, openCardDoc, closeCardDoc, createLesson, updateCard } from "./store.js";

function textOf(node) {
  if (node instanceof Y.XmlText) return node.toDelta().map((d) => (typeof d.insert === "string" ? d.insert : "")).join("");
  const kids = node.toArray ? node.toArray() : [];
  const name = node.nodeName || "";
  if (name === "heading") return "#".repeat(Number(node.getAttribute("level")) || 1) + " " + kids.map(textOf).join("");
  if (name === "listItem" || name === "taskItem") return "- " + kids.map(textOf).join("\n").replace(/\n/g, "\n  ");
  if (kids.length && kids.every((k) => k instanceof Y.XmlText)) return kids.map(textOf).join("");
  return kids.map(textOf).filter((t) => t !== "").join("\n");
}

function paragraph(line) {
  const p = new Y.XmlElement("paragraph");
  if (line) { const t = new Y.XmlText(); t.insert(0, line); p.insert(0, [t]); }
  return p;
}

async function fresh(id) {
  const entry = openCardDoc(id);
  await Promise.race([entry.idb.whenSynced, new Promise((r) => setTimeout(r, 1500))]);
  await new Promise((resolve) => {
    if (entry.provider.synced) return resolve();
    entry.provider.once("sync", resolve);
    setTimeout(resolve, 4000);
  });
  return entry;
}

function needCard(id) {
  const c = card(id);
  if (!c || c.deleted) throw new Error("No such card: " + id);
  return c;
}

export function installConnector({ enter }) {
  const api = {
    version: 1,
    async status() {
      await state.ready;
      return { me: me(), people: NAMES.filter((n) => (users.get(n) || {}).color) };
    },
    async enter(name) {
      await state.ready;
      if (!NAMES.includes(name) || !(users.get(name) || {}).color) throw new Error("Unknown person: " + name);
      enter(name);
      return name;
    },
    async subjects() {
      await state.ready;
      return listSubjects().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji || "" }));
    },
    async cards(subjectId) {
      await state.ready;
      if (!subject(subjectId)) throw new Error("No such subject: " + subjectId);
      return listCards(subjectId).map((c) => ({ id: c.id, kind: c.kind || "", date: c.date || "", title: c.title || "" }));
    },
    async read(id) {
      await state.ready;
      needCard(id);
      const entry = await fresh(id);
      try { return textOf(entry.doc.getXmlFragment("prosemirror")).slice(0, 20000); } finally { closeCardDoc(id); }
    },
    async append(id, text) {
      await state.ready;
      if (!me()) throw new Error("Enter as a person first");
      needCard(id);
      const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).slice(0, 200);
      const entry = await fresh(id);
      try {
        const frag = entry.doc.getXmlFragment("prosemirror");
        entry.doc.transact(() => frag.insert(frag.length, lines.map(paragraph)));
        updateCard(id, { updated: Date.now() });
        await new Promise((resolve) => {
          const done = () => setTimeout(resolve, 500);
          if (entry.provider.synced) done(); else { entry.provider.once("sync", done); setTimeout(resolve, 5000); }
        });
        return { ok: true, paragraphs: lines.length };
      } finally { closeCardDoc(id); }
    },
    async newLesson(subjectId) {
      await state.ready;
      if (!me()) throw new Error("Enter as a person first");
      if (!subject(subjectId)) throw new Error("No such subject: " + subjectId);
      return createLesson(subjectId);
    },
    open(id) {
      needCard(id);
      location.hash = "#/c/" + id;
      return "opened, the card is now on screen";
    }
  };
  Object.defineProperty(window, "pupka", { value: Object.freeze(api), configurable: false, writable: false });
}
