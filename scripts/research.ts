import Anthropic from "@anthropic-ai/sdk";
import { closePool } from "../lib/db";
import { tasksFor } from "../lib/briefs";
import { runTask, settingsFromEnv } from "../lib/research";
import { SECTIONS, type Section } from "../lib/types";

// Usage: npm run research -- [--section sooz|personal] [--task <id>] [--dry]
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};
const dryRun = args.includes("--dry");
const section = flag("section") as Section | undefined;
const taskId = flag("task");

if (section && !SECTIONS.includes(section)) {
  console.error(`--section must be one of: ${SECTIONS.join(", ")}`);
  process.exit(2);
}

const tasks = tasksFor(section, taskId);
if (tasks.length === 0) {
  console.error("No matching tasks.");
  process.exit(2);
}

const settings = settingsFromEnv();
const client = new Anthropic();
console.log(`Model: ${settings.model} · tasks: ${tasks.map((t) => t.id).join(", ")}${dryRun ? " · DRY RUN" : ""}`);

// Tasks run one after another: each leans on web search and we'd rather not trip rate limits.
const results = [];
for (const task of tasks) {
  results.push(await runTask(client, task, settings, { dryRun, log: console.log }));
}

console.log("\nSummary");
for (const r of results) {
  console.log(
    r.error
      ? `  ✗ ${r.taskId}: ${r.error}`
      : `  ✓ ${r.taskId}: ${r.found} found, ${r.inserted} new, ${r.updated} refreshed`,
  );
}
await closePool().catch(() => {});
// Fail the CI job only if *every* task failed; partial results are still useful.
process.exit(results.every((r) => r.error) ? 1 : 0);
