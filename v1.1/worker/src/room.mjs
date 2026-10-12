/* Room: one Durable Object per Yjs document (the index or a single card).
   Speaks the y-websocket protocol over Cloudflare's hibernatable WebSockets, keeps the doc in memory,
   persists it in SQLite in chunks, and keeps a silent daily backup for two weeks. */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const CHUNK = 900 * 1024;
const BACKUP_DAYS = 14;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.conns = new Set();
    this.controlled = new Map();
    this.saveTimer = null;
    this.dirty = false;
    this.stats = { msgs: 0, errors: [] };
    this.ctx.blockConcurrencyWhile(async () => {
      await this.load();
      for (const ws of this.ctx.getWebSockets()) this.register(ws);
    });
  }

  async load() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS chunks (i INTEGER PRIMARY KEY, v BLOB)");
    sql.exec("CREATE TABLE IF NOT EXISTS backups (d TEXT PRIMARY KEY, v BLOB)");
    this.doc = new Y.Doc();
    const rows = sql.exec("SELECT v FROM chunks ORDER BY i").toArray();
    if (rows.length) {
      const total = rows.reduce((n, r) => n + r.v.byteLength, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const r of rows) { buf.set(new Uint8Array(r.v), off); off += r.v.byteLength; }
      try { Y.applyUpdate(this.doc, buf); } catch (e) { console.error("corrupt state", e); }
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on("update", (update, origin) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), origin);
      this.dirty = true;
      this.scheduleSave();
    });
    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      if (origin && this.controlled.has(origin)) {
        const set = this.controlled.get(origin);
        added.forEach((id) => set.add(id));
        removed.forEach((id) => set.delete(id));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc), null);
    });
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1500);
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    const state = Y.encodeStateAsUpdate(this.doc);
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM chunks");
      for (let i = 0, off = 0; off < state.byteLength; i++, off += CHUNK) {
        sql.exec("INSERT INTO chunks (i, v) VALUES (?, ?)", i, state.slice(off, off + CHUNK));
      }
      const today = new Date().toISOString().slice(0, 10);
      const have = sql.exec("SELECT d FROM backups WHERE d = ?", today).toArray();
      if (!have.length && state.byteLength < 1_900_000) {
        sql.exec("INSERT INTO backups (d, v) VALUES (?, ?)", today, state);
        const cutoff = new Date(Date.now() - BACKUP_DAYS * 864e5).toISOString().slice(0, 10);
        sql.exec("DELETE FROM backups WHERE d < ?", cutoff);
      }
    });
  }

  register(ws) {
    if (this.conns.has(ws)) return;
    this.conns.add(ws);
    this.controlled.set(ws, new Set());
  }

  broadcast(buf, except) {
    for (const c of this.conns) {
      if (c === except) continue;
      try { c.send(buf); } catch (e) { this.drop(c); }
    }
  }

  send(conn, buf) {
    try { conn.send(buf); } catch (e) { this.drop(conn); }
  }

  drop(conn) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    const ids = this.controlled.get(conn);
    this.controlled.delete(conn);
    if (ids && ids.size) awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), null);
    try { conn.close(1000, "bye"); } catch (e) { /* already closed */ }
    if (!this.conns.size) { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; } this.save(); }
  }

  async webSocketMessage(ws, raw) {
    this.register(ws);
    this.stats.msgs++;
    try {
      let data = raw;
      if (typeof raw === "string") return;
      if (raw && typeof raw.arrayBuffer === "function") data = await raw.arrayBuffer();
      else if (ArrayBuffer.isView(raw)) data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
        if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (e) {
      console.error("ws message error", e);
      if (this.stats.errors.length < 10) this.stats.errors.push(String((e && e.stack) || e).slice(0, 300));
    }
  }

  webSocketClose(ws) { this.drop(ws); }
  webSocketError(ws) { this.drop(ws); }

  openSocket() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.register(server);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(server, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size) {
      const aenc = encoding.createEncoder();
      encoding.writeVarUint(aenc, MSG_AWARENESS);
      encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())));
      this.send(server, encoding.toUint8Array(aenc));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  textOf() {
    const frag = this.doc.getXmlFragment("prosemirror");
    const out = [];
    let i = 0;
    for (const node of frag.toArray()) {
      i++;
      const xml = node.toString();
      const text = xml
        .replace(/<\/(paragraph|heading|listItem|tableRow|callout)>/g, "\n")
        .replace(/<math[^>]*latex="([^"]*)"[^>]*>(<\/math>)?/g, (m, l) => "$" + decode(l) + "$")
        .replace(/<image[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)")?[^>]*>(<\/image>)?/g, (m, s, a) => `![${decode(a || "")}](${decode(s)})`)
        .replace(/<[^>]+>/g, "")
        .replace(/\n+$/, "");
      out.push(`[${i}] ${decode(text).trim()}`);
    }
    return out.join("\n");
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return this.openSocket();
    }
    if (url.pathname === "/text") return new Response(this.textOf(), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (url.pathname === "/json") {
      const obj = {};
      for (const k of ["subjects", "cards", "users", "settings", "plan"]) obj[k] = this.doc.getMap(k).toJSON();
      return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/backups") {
      const rows = this.ctx.storage.sql.exec("SELECT d, length(v) AS n FROM backups ORDER BY d").toArray();
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/stats") {
      return new Response(JSON.stringify({ conns: this.conns.size, sockets: this.ctx.getWebSockets().length, bytes: Y.encodeStateAsUpdate(this.doc).byteLength, msgs: this.stats.msgs, errors: this.stats.errors }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
}

function decode(s) {
  return String(s || "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
