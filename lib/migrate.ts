import { createHash } from "node:crypto";
import type pg from "pg";
import { getPool } from "./db";
import { SCHEMA_SQL } from "./schema-sql";

export const SCHEMA_HASH = createHash("sha256").update(SCHEMA_SQL).digest("hex");

/**
 * Apply db/schema.sql if the database hasn't seen this exact version yet. The schema is idempotent;
 * the advisory lock keeps concurrent cold starts from racing; the hash check makes the common case one query.
 */
export async function ensureSchema(pool: pg.Pool = getPool(), force = false): Promise<"applied" | "current"> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(727274)");
    await client.query(
      `create table if not exists schema_version (id int primary key default 1, hash text not null, applied_at timestamptz not null default now())`,
    );
    const cur = await client.query<{ hash: string }>(`select hash from schema_version where id = 1`);
    if (!force && cur.rows[0]?.hash === SCHEMA_HASH) {
      await client.query("commit");
      return "current";
    }
    await client.query(SCHEMA_SQL);
    await client.query(
      `insert into schema_version (id, hash) values (1, $1)
       on conflict (id) do update set hash = excluded.hash, applied_at = now()`,
      [SCHEMA_HASH],
    );
    await client.query("commit");
    return "applied";
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
