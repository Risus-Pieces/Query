// Single-user password gate. Stateless signed cookie; uses Web Crypto so it runs anywhere.
export const COOKIE = "oq_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return s;
}

export async function passwordOk(input: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  // Compare HMACs so length / early-exit don't leak.
  const [a, b] = await Promise.all([hmac(secret(), `pw:${input}`), hmac(secret(), `pw:${expected}`)]);
  return safeEqual(a, b);
}

export async function createSession(now = Date.now()): Promise<{ value: string; maxAge: number }> {
  const exp = Math.floor(now / 1000) + MAX_AGE_S;
  return { value: `${exp}.${await hmac(secret(), `session:${exp}`)}`, maxAge: MAX_AGE_S };
}

export async function verifySession(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  const expN = Number(exp);
  if (!sig || !Number.isFinite(expN) || expN < Math.floor(now / 1000)) return false;
  return safeEqual(sig, await hmac(secret(), `session:${exp}`));
}
