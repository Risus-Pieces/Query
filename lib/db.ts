import pg from "pg";

// pg returns DATE columns as JS Dates (shifted by timezone). We want plain
// 'YYYY-MM-DD' strings, so register a parser for type 1082 (date).
pg.types.setTypeParser(1082, (v) => v);
// bigserial ids: safe as JS numbers at this scale. timestamptz: ISO strings (serialisable across RSC boundaries).
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({
      connectionString,
      // Serverless-friendly: one connection per instance, Neon's pooler does the rest.
      max: process.env.VERCEL ? 1 : 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
