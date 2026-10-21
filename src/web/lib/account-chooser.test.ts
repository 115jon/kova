import { describe, expect, it } from "vitest";
import { chooserAccounts, type DeviceSession } from "./account-chooser";

function entry(sessionId: string, userId: string, updatedAt: string, extra: Partial<DeviceSession["user"]> = {}): DeviceSession {
  return {
    session: { id: sessionId, token: `tok-${sessionId}`, updatedAt },
    user: { id: userId, email: `${userId}@example.com`, name: null, image: null, ...extra },
  };
}

describe("chooserAccounts", () => {
  it("lists the active account first, then the most recently used", () => {
    const accounts = chooserAccounts([
      entry("s1", "ann", "2026-10-18T00:00:00Z"),
      entry("s2", "bob", "2026-10-20T00:00:00Z"),
      entry("s3", "cy", "2026-10-19T00:00:00Z"),
    ], "s1");
    expect(accounts.map((a) => a.userId)).toEqual(["ann", "bob", "cy"]);
  });

  it("shows each person once, keeping the active session", () => {
    const accounts = chooserAccounts([
      entry("s1", "ann", "2026-10-20T00:00:00Z"),
      entry("s2", "ann", "2026-10-10T00:00:00Z"),
      entry("s3", "bob", "2026-10-19T00:00:00Z"),
      entry("s4", "bob", "2026-10-19T06:00:00Z"),
    ], "s2");
    expect(accounts.map((a) => a.sessionId)).toEqual(["s2", "s4"]);
  });

  it("falls back to the email when there is no name and skips unusable entries", () => {
    const accounts = chooserAccounts([
      entry("s1", "ann", "2026-10-20T00:00:00Z", { name: "  " }),
      { session: { id: "s2", token: "" }, user: { id: "bob", email: "bob@example.com" } },
    ], "s1");
    expect(accounts).toEqual([{
      sessionId: "s1", sessionToken: "tok-s1", userId: "ann", name: "ann@example.com", email: "ann@example.com", image: null,
    }]);
  });
});
