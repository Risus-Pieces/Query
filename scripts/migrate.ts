import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closePool, getPool } from "../lib/db";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "../db/schema.sql"), "utf8");

await getPool().query(sql);
console.log("Schema is up to date.");
await closePool();
