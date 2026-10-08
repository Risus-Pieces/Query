import { closePool } from "../lib/db";
import { ensureSchema } from "../lib/migrate";

// Usage: npm run db:migrate [-- --force]
const r = await ensureSchema(undefined, process.argv.includes("--force"));
console.log(r === "applied" ? "Schema applied." : "Schema is up to date.");
await closePool();
