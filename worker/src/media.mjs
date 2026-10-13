/* Media: one Durable Object that stores every uploaded image in SQLite (no R2 needed on this account).
   Small files live in one row (legacy table `media`), larger ones (big GIFs) are split into 1.5 MB chunks in `big`. */

const ROW_MAX = 1_800_000;
const CHUNK = 1_500_000;
export const MAX_TOTAL = 14_000_000;

export class Media {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS media (k TEXT PRIMARY KEY, ct TEXT, ts INTEGER, v BLOB)");
      sql.exec("CREATE TABLE IF NOT EXISTS big (k TEXT, i INTEGER, ct TEXT, v BLOB, PRIMARY KEY (k, i))");
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const sql = this.ctx.storage.sql;
    if (req.method === "PUT") {
      const key = url.pathname.slice(1);
      const ct = req.headers.get("content-type") || "application/octet-stream";
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_TOTAL) return new Response("too large", { status: 413 });
      this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM media WHERE k = ?", key);
        sql.exec("DELETE FROM big WHERE k = ?", key);
        if (buf.byteLength <= ROW_MAX) sql.exec("INSERT INTO media (k, ct, ts, v) VALUES (?, ?, ?, ?)", key, ct, Date.now(), buf);
        else for (let i = 0, off = 0; off < buf.byteLength; i++, off += CHUNK) sql.exec("INSERT INTO big (k, i, ct, v) VALUES (?, ?, ?, ?)", key, i, ct, buf.slice(off, off + CHUNK));
      });
      return new Response("ok");
    }
    if (req.method === "GET") {
      if (url.pathname === "/_stats") {
        const a = sql.exec("SELECT count(*) AS n, coalesce(sum(length(v)),0) AS bytes FROM media").one();
        const b = sql.exec("SELECT count(DISTINCT k) AS n, coalesce(sum(length(v)),0) AS bytes FROM big").one();
        return new Response(JSON.stringify({ small: a, big: b }), { headers: { "content-type": "application/json" } });
      }
      const key = url.pathname.slice(1);
      const rows = sql.exec("SELECT ct, v FROM media WHERE k = ?", key).toArray();
      if (rows.length) return new Response(rows[0].v, { headers: { "content-type": rows[0].ct } });
      const parts = sql.exec("SELECT ct, v FROM big WHERE k = ? ORDER BY i", key).toArray();
      if (!parts.length) return new Response("not found", { status: 404 });
      const total = parts.reduce((n, r) => n + r.v.byteLength, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const r of parts) { out.set(new Uint8Array(r.v), off); off += r.v.byteLength; }
      return new Response(out, { headers: { "content-type": parts[0].ct } });
    }
    return new Response("method", { status: 405 });
  }
}
