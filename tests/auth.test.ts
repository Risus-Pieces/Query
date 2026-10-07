import { beforeEach, describe, expect, it } from "vitest";
import { createSession, passwordOk, verifySession } from "@/lib/auth";

beforeEach(() => {
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.DASHBOARD_PASSWORD = "correct horse";
});

describe("auth", () => {
  it("accepts only the right password", async () => {
    expect(await passwordOk("correct horse")).toBe(true);
    expect(await passwordOk("correct hors")).toBe(false);
    expect(await passwordOk("")).toBe(false);
  });
  it("rejects everything when no password is configured", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    expect(await passwordOk("")).toBe(false);
    expect(await passwordOk("undefined")).toBe(false);
  });
  it("round-trips a session and rejects tampering", async () => {
    const { value } = await createSession();
    expect(await verifySession(value)).toBe(true);
    const [exp, sig] = value.split(".");
    expect(await verifySession(`${Number(exp) + 99999}.${sig}`)).toBe(false);
    const flipped = sig.endsWith("0") ? "1" : "0"; // always differs from the real last char
    expect(await verifySession(`${exp}.${sig.slice(0, -1)}${flipped}`)).toBe(false);
    expect(await verifySession(undefined)).toBe(false);
    expect(await verifySession("garbage")).toBe(false);
  });
  it("expires sessions", async () => {
    const { value } = await createSession(Date.now() - 31 * 864e5);
    expect(await verifySession(value)).toBe(false);
  });
  it("invalidates sessions when the secret rotates", async () => {
    const { value } = await createSession();
    process.env.SESSION_SECRET = "ffffffffffffffffffffffffffffffff";
    expect(await verifySession(value)).toBe(false);
  });
  it("refuses to run with a weak secret", async () => {
    process.env.SESSION_SECRET = "short";
    await expect(createSession()).rejects.toThrow(/SESSION_SECRET/);
  });
});
