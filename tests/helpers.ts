import { readFileSync } from "node:fs";
import { getPool } from "../lib/db";

export const hasDb = !!process.env.TEST_DATABASE_URL;

/** Point the app at the test DB, apply the schema, and start from empty tables. */
export async function resetDb() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const pool = getPool();
  await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await pool.query("truncate items, runs, outreach, outreach_events, network, settings restart identity cascade");
}
