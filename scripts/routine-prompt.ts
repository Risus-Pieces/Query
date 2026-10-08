// Prints the routine prompts. Usage: npm run routine-prompt -- research|digest
import { buildDigestRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "../lib/routine";

const which = process.argv[2];
const home = process.env.HOME_BASE || "Houston, TX";
if (which === "research") console.log(buildResearchRoutinePrompt(home));
else if (which === "digest")
  console.log(
    buildDigestRoutinePrompt(
      process.env.DIGEST_TO || "boxuanzhao1128@gmail.com",
      process.env.DASHBOARD_URL || "https://opportunity-query.vercel.app",
    ),
  );
else if (which === "outreach") console.log(buildOutreachRoutinePrompt({ apolloBudget: Number(process.env.APOLLO_BUDGET ?? 5), minScore: 75 }));
else {
  console.error("usage: routine-prompt research|digest|outreach");
  process.exit(2);
}
