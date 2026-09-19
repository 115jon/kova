import { describe, expect, it } from "vitest";
import { shouldMintAppSessionToken } from "./session-token";

describe("shouldMintAppSessionToken", () => {
  it("mints when the SDK has a publishable key and no bearer yet", () => {
    expect(
      shouldMintAppSessionToken({
        publishableKey: "pk_dev_test",
        sessionToken: null,
        isPending: false,
      }),
    ).toBe(true);
  });

  it("does not wait for get-session to already return a user", () => {
    expect(
      shouldMintAppSessionToken({
        publishableKey: "pk_dev_test",
        sessionToken: null,
        isPending: false,
      }),
    ).toBe(true);
  });

  it("skips while session lookup is in flight, when a bearer exists, or without a pk", () => {
    expect(
      shouldMintAppSessionToken({
        publishableKey: "pk_dev_test",
        sessionToken: null,
        isPending: true,
      }),
    ).toBe(false);
    expect(
      shouldMintAppSessionToken({
        publishableKey: "pk_dev_test",
        sessionToken: "tok_1",
        isPending: false,
      }),
    ).toBe(false);
    expect(
      shouldMintAppSessionToken({
        sessionToken: null,
        isPending: false,
      }),
    ).toBe(false);
  });
});
