// Embeds db/schema.sql into lib/schema-sql.ts so the deployed app can migrate itself.
// Run after editing db/schema.sql: npm run gen:schema  (a test fails if they drift).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "../db/schema.sql"), "utf8");
if (sql.includes("`") || sql.includes("${") || sql.endsWith("\\")) {
  throw new Error("schema.sql can't contain backticks, ${ or a trailing backslash (embedded as String.raw)");
}
writeFileSync(
  join(here, "../lib/schema-sql.ts"),
  "// GENERATED from db/schema.sql by scripts/gen-schema.ts — do not edit by hand.\nexport const SCHEMA_SQL = String.raw`" + sql + "`;\n",
);
console.log(`lib/schema-sql.ts updated (${sql.length} chars)`);
