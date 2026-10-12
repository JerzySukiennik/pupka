/* Media: one Durable Object that stores every uploaded image in SQLite (no R2 needed on this account).
   Images are downscaled by the client before upload, so rows stay far below the 2 MB value limit. */

const MAX_ROW = 1_900_000;

export class Media {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS media (k TEXT PRIMARY KEY, ct TEXT, ts INTEGER, v BLOB)");
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const sql = this.ctx.storage.sql;
    if (req.method === "PUT") {
      const key = url.pathname.slice(1);
      const ct = req.headers.get("content-type") || "application/octet-stream";
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_ROW) return new Response("too large", { status: 413 });
      sql.exec("INSERT OR REPLACE INTO media (k, ct, ts, v) VALUES (?, ?, ?, ?)", key, ct, Date.now(), buf);
      return new Response("ok");
    }
    if (req.method === "GET") {
      if (url.pathname === "/_stats") {
        const r = sql.exec("SELECT count(*) AS n, coalesce(sum(length(v)),0) AS bytes FROM media").one();
        return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
      }
      const key = url.pathname.slice(1);
      const rows = sql.exec("SELECT ct, v FROM media WHERE k = ?", key).toArray();
      if (!rows.length) return new Response("not found", { status: 404 });
      return new Response(rows[0].v, { headers: { "content-type": rows[0].ct } });
    }
    return new Response("method", { status: 405 });
  }
}
