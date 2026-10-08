// Runs once when a server instance starts: keep the database schema in sync with this deploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { ensureSchema } = await import("./lib/migrate");
  try {
    const r = await ensureSchema();
    if (r === "applied") console.log("[schema] applied");
  } catch (err) {
    console.error("[schema] migration failed:", err);
  }
}
