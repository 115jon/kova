import { describe, expect, it } from "vitest";
import { hasAdminRole, isAllowlistedAdminEmail, parseEmailAllowlist } from "./roles";

describe("roles", () => {
  it("treats comma-separated roles as admin when admin is present", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("user,admin")).toBe(true);
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
  });

  it("parses a comma-separated allowlist with trim and lowercase", () => {
    expect(parseEmailAllowlist(" Alpha , Beta.Test ")).toEqual([
      "alpha",
      "beta.test",
    ]);
  });

  it("allows any admin when the allowlist is empty", () => {
    expect(isAllowlistedAdminEmail("alpha", "")).toBe(true);
    expect(isAllowlistedAdminEmail("alpha", null)).toBe(true);
  });

  it("matches one address out of a comma-separated allowlist", () => {
    const list = "alpha,beta.test";
    expect(isAllowlistedAdminEmail("Alpha", list)).toBe(true);
    expect(isAllowlistedAdminEmail("beta.test", list)).toBe(true);
    expect(isAllowlistedAdminEmail("other", list)).toBe(false);
  });
});
