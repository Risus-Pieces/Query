import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeUrl, slug } from "@/lib/dedupe";

describe("normalizeUrl", () => {
  it("drops tracking params, hash, www and trailing slash", () => {
    expect(normalizeUrl("https://www.Example.com/Events/?utm_source=x&b=2&a=1#top")).toBe("example.com/Events?a=1&b=2");
  });
  it("rejects non-http(s) and garbage", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
  });
  it("treats tracking-only variants as the same page", () => {
    expect(normalizeUrl("https://a.com/p?utm_campaign=1")).toBe(normalizeUrl("http://www.a.com/p/"));
  });
});

describe("dedupeKey", () => {
  it("identifies angels by person, not by source page", () => {
    const a = dedupeKey({ section: "sooz", kind: "angel", title: "Jane  Doe", url: "https://a.com/x", firm: "Acme VC" });
    const b = dedupeKey({ section: "sooz", kind: "angel", title: "jane doe", url: "https://b.com/y", firm: "ACME VC" });
    expect(a).toBe(b);
  });
  it("keeps same-named angels at different firms apart", () => {
    const a = dedupeKey({ section: "sooz", kind: "angel", title: "Jane Doe", firm: "Acme" });
    const b = dedupeKey({ section: "sooz", kind: "angel", title: "Jane Doe", firm: "Other" });
    expect(a).not.toBe(b);
  });
  it("identifies other items by canonical URL", () => {
    const a = dedupeKey({ section: "personal", kind: "event", title: "Hack", url: "https://x.com/e?utm_source=a" });
    const b = dedupeKey({ section: "personal", kind: "hackathon", title: "Hack 2", url: "https://www.x.com/e/" });
    expect(a).toBe(b);
  });
  it("scopes keys by section", () => {
    const u = "https://x.com/e";
    expect(dedupeKey({ section: "sooz", kind: "event", title: "t", url: u })).not.toBe(
      dedupeKey({ section: "personal", kind: "event", title: "t", url: u }),
    );
  });
  it("slug strips accents and punctuation", () => {
    expect(slug("José  O'Neil!")).toBe("jose-o-neil");
  });
});
