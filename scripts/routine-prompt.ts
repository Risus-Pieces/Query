// Prints the routine prompts. Usage: npm run routine-prompt -- research [sooz|personal,career|...] | outreach | digest
import { buildDigestRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "../lib/routine";
import { SECTIONS, type Section } from "../lib/types";

const [which, arg] = process.argv.slice(2);
const home = process.env.HOME_BASE || "Houston, TX";
if (which === "research") {
  const sections = (arg ? arg.split(",") : [...SECTIONS]).map((x) => x.trim()) as Section[];
  const bad = sections.filter((x) => !(SECTIONS as readonly string[]).includes(x));
  if (bad.length) {
    console.error(`unknown section(s): ${bad.join(", ")}`);
    process.exit(2);
  }
  console.log(buildResearchRoutinePrompt(sections, home));
} else if (which === "digest")
  console.log(
    buildDigestRoutinePrompt(
      process.env.DIGEST_TO || "boxuanzhao1128@gmail.com",
      process.env.DASHBOARD_URL || "https://opportunity-query.vercel.app",
    ),
  );
else if (which === "outreach") console.log(buildOutreachRoutinePrompt({ apolloBudget: Number(process.env.APOLLO_BUDGET ?? 5), minScore: 75 }));
else {
  console.error("usage: routine-prompt research [sections] | digest | outreach");
  process.exit(2);
}
