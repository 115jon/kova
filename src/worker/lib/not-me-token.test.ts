import { describe, expect, it } from "vitest";
import { type NotMePayload, signNotMeToken, verifyNotMeToken } from "./not-me-token";

const SECRET = "test-secret-test-secret-test-secret-12345";
const NOW = Date.UTC(2026, 10, 5, 12);
const payload: NotMePayload = { u: "user_1", a: "alert_1", e: NOW + 60_000, app: "app_1", t: NOW - 1000 };

describe("not-me token", () => {
  it("round-trips a signed payload", async () => {
    const token = await signNotMeToken(SECRET, payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyNotMeToken(SECRET, token, NOW)).toEqual(payload);
  });

  it("rejects an expired token", async () => {
    const token = await signNotMeToken(SECRET, payload);
    expect(await verifyNotMeToken(SECRET, token, payload.e)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signNotMeToken("another-secret-another-secret-another", payload);
    expect(await verifyNotMeToken(SECRET, token, NOW)).toBeNull();
  });

  it("rejects a tampered payload or signature", async () => {
    const token = await signNotMeToken(SECRET, payload);
    const [body, signature] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, u: "user_2" })).toString("base64url");
    expect(await verifyNotMeToken(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(await verifyNotMeToken(SECRET, `${body}.${flipped}`, NOW)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    for (const token of ["", "abc", "a.b.c", "!!.??", `${"a".repeat(3000)}.b`]) {
      expect(await verifyNotMeToken(SECRET, token, NOW)).toBeNull();
    }
  });
});
