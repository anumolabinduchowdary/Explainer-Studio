import { beforeEach, describe, expect, it } from "vitest";
import { authSettings, isAllowed, parseAllowlist } from "@/lib/config";
import { safeNext } from "@/lib/google";
import { createSession, openSecret, readSession, readToken, sameSecret, sealSecret, signToken } from "@/lib/session";

beforeEach(() => {
  process.env.AUTH_SECRET = "a".repeat(40);
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.ALLOWED_EMAILS = "";
});

describe("secrets and cookies", () => {
  it("encrypts Google permissions so only this app's secret opens them", async () => {
    const settings = authSettings();
    const sealed = await sealSecret(settings, "1//refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(await openSecret(settings, sealed)).toBe("1//refresh-token");
    process.env.AUTH_SECRET = "b".repeat(40);
    expect(await openSecret(authSettings(), sealed)).toBeNull();
  });

  it("never accepts one kind of token as another", async () => {
    const settings = authSettings();
    const attempt = await signToken(settings, "google", { sub: "ana@example.org" }, 600);
    expect(await readSession(settings, attempt)).toBeNull();
    const session = await createSession(settings, { email: "ana@example.org" });
    expect(await readToken(settings, "google", session)).toBeNull();
    expect((await readSession(settings, session))?.email).toBe("ana@example.org");
  });

  it("signs out someone removed from ALLOWED_EMAILS", async () => {
    const session = await createSession(authSettings(), { email: "ana@example.org" });
    process.env.ALLOWED_EMAILS = "ben@example.org, @school.edu";
    expect(await readSession(authSettings(), session)).toBeNull();
    expect(isAllowed(parseAllowlist("ben@example.org, @school.edu"), "kim@school.edu")).toBe(true);
  });

  it("compares secrets exactly", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("", "abc")).toBe(false);
  });

  it("only returns to this app's own pages after signing in", () => {
    expect(safeNext("/videos/abc123def45")).toBe("/videos/abc123def45");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/videos/../api/cron")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
