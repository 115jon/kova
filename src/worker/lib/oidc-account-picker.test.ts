import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrlAfterAccountSelected,
  buildOidcContinueLocation,
  safeOauthContinuePath,
  shouldOfferOidcAccountPicker,
  sortAccountsLastUsedFirst,
} from "./oidc-account-picker";

describe("OIDC account picker gate", () => {
  const forgejo = "forgejo-client";

  it("sends 1:15 authorize through the picker until an account is chosen", () => {
    expect(
      shouldOfferOidcAccountPicker({
        method: "GET",
        pathname: "/api/auth/oauth2/authorize",
        clientId: forgejo,
        forgejoClientId: forgejo,
        accountSelected: null,
      }),
    ).toBe(true);
  });

  it("lets the chosen-account retry through to Better Auth", () => {
    expect(
      shouldOfferOidcAccountPicker({
        method: "GET",
        pathname: "/api/auth/oauth2/authorize",
        clientId: forgejo,
        forgejoClientId: forgejo,
        accountSelected: "1",
      }),
    ).toBe(false);
  });

  it("does not steal other OIDC clients", () => {
    expect(
      shouldOfferOidcAccountPicker({
        method: "GET",
        pathname: "/api/auth/oauth2/authorize",
        clientId: "other-app",
        forgejoClientId: forgejo,
        accountSelected: null,
      }),
    ).toBe(false);
  });
});

describe("OIDC continue URLs", () => {
  it("drops the selected flag when bouncing to the picker", () => {
    expect(
      buildOidcContinueLocation(
        "https://auth.115jon.site",
        "?client_id=forgejo-client&state=abc&account_selected=1",
      ),
    ).toBe(
      "https://auth.115jon.site/oauth/continue?client_id=forgejo-client&state=abc",
    );
  });

  it("marks authorize as account-selected after a pick", () => {
    expect(
      buildAuthorizeUrlAfterAccountSelected(
        "https://auth.115jon.site",
        "?client_id=forgejo-client&state=abc",
      ),
    ).toBe(
      "https://auth.115jon.site/api/auth/oauth2/authorize?client_id=forgejo-client&state=abc&account_selected=1",
    );
  });
});

describe("sortAccountsLastUsedFirst", () => {
  it("puts the last-used Forgejo account first", () => {
    const accounts = [
      { user: { id: "a" } },
      { user: { id: "b" } },
      { user: { id: "c" } },
    ];
    expect(sortAccountsLastUsedFirst(accounts, "c").map((item) => item.user.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("leaves order alone without a last-used id", () => {
    const accounts = [{ user: { id: "a" } }, { user: { id: "b" } }];
    expect(sortAccountsLastUsedFirst(accounts, null)).toEqual(accounts);
  });
});

describe("safeOauthContinuePath", () => {
  it("allows the continue page and its query", () => {
    expect(safeOauthContinuePath("/oauth/continue")).toBe("/oauth/continue");
    expect(
      safeOauthContinuePath("/oauth/continue?client_id=forgejo-client&state=abc"),
    ).toBe("/oauth/continue?client_id=forgejo-client&state=abc");
  });

  it("keeps a nested Forgejo redirect_uri so add-account can return to the picker", () => {
    expect(
      safeOauthContinuePath(
        "/oauth/continue?client_id=forgejo-115&redirect_uri=https://git.115jon.com/user/oauth2/kova/callback&state=abc",
      ),
    ).toBe(
      "/oauth/continue?client_id=forgejo-115&redirect_uri=https://git.115jon.com/user/oauth2/kova/callback&state=abc",
    );
  });

  it("rejects open redirects", () => {
    expect(safeOauthContinuePath("https://evil.example/oauth/continue")).toBeNull();
    expect(safeOauthContinuePath("/oauth/continue/../sign-in")).toBeNull();
    expect(safeOauthContinuePath("//evil.example")).toBeNull();
    expect(safeOauthContinuePath("/settings")).toBeNull();
  });
});
