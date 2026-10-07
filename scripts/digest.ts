import { closePool } from "../lib/db";
import {
  collectDigest,
  digestCount,
  mailConfigFromEnv,
  markDigested,
  renderDigest,
  sendEmail,
} from "../lib/digest";
import { todayISO } from "../lib/research";

// Usage: npm run digest [-- --print]   (--print: render to stdout, send nothing, mark nothing)
const printOnly = process.argv.includes("--print");
const minScore = Number(process.env.DIGEST_MIN_SCORE ?? 55);

const data = await collectDigest(minScore, todayISO());
const mail = renderDigest(data, process.env.DASHBOARD_URL);

if (printOnly) {
  console.log(`Subject: ${mail.subject}\n\n${mail.text}`);
} else if (digestCount(data) === 0 && data.upcoming.length === 0) {
  console.log("Nothing to send.");
} else {
  const cfg = mailConfigFromEnv();
  if (!cfg) {
    console.error("RESEND_API_KEY / DIGEST_TO / DIGEST_FROM not set — digest not sent (items stay un-emailed).");
    console.log(`Subject: ${mail.subject}\n\n${mail.text}`);
    await closePool();
    process.exit(1);
  }
  await sendEmail(cfg, mail);
  await markDigested([...data.fresh.sooz, ...data.fresh.personal].map((i) => i.id));
  console.log(`Digest sent to ${cfg.to}: ${mail.subject}`);
}
await closePool();
