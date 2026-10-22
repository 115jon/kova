import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  carriesAppScopedSession,
  isPlatformOnlyAuthPath,
  platformSessionOnly,
  requestSessionTokens,
} from "./platform-session";

/** A session table where only the listed tokens belong to an app. */
function sessionDb(appScopedTokens: string[], fails = false) {
  const queries: string[][] = [];
  const db = {
    prepare: () => ({
      bind: (...tokens: string[]) => ({
        first: async () => {
          queries.push(tokens);
          if (fails) throw new Error("D1 unavailable");
          return tokens.some(token => appScopedTokens.includes(token)) ? { scoped: 1 } : null;
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, queries };
}

describe("isPlatformOnlyAuthPath", () => {
  it.each([
    "/api/auth/admin/list-users",
    "/api/auth/admin/set-role",
    "/api/auth/api-key/create",
    "/api/auth/organization/create",
    "/api/auth/organization/invite-member",
    "/api/auth/organization/delete",
    "/api/auth/organization/list-members",
    "/api/auth/delete-user",
    "/api/auth/change-email",
    "/api/auth/change-password",
    "/api/auth/unlink-account",
    "/api/auth/link-social",
    "/api/auth/list-sessions",
    "/api/auth/revoke-other-sessions",
    "/api/auth/two-factor/disable",
    "/api/auth/passkey/delete-passkey",
    "/api/auth/passkey/verify-registration",
    "/api/auth/Admin/list-users",
    "/api/auth//admin/list-users",
    "/api/auth/admin/list-users/",
    "/api/auth/%61dmin/list-users",
    "/api/auth/%zz",
    "/api/auth/oauth2/create-client",
    "/api/auth/oauth2/get-clients",
    "/api/auth/oauth2/update-client",
    "/api/auth/oauth2/client/rotate-secret",
    "/api/auth/oauth2/delete-consent",
    "/api/auth/admin/oauth2/create-client",
  ])("denies %s", (path) => {
    expect(isPlatformOnlyAuthPath(path)).toBe(true);
  });

  it.each([
    "/api/auth/get-session",
    "/api/auth/sign-out",
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/sign-in/social",
    "/api/auth/update-user",
    "/api/auth/revoke-session",
    "/api/auth/list-accounts",
    "/api/auth/multi-session/list-device-sessions",
    "/api/auth/multi-session/set-active",
    "/api/auth/multi-session/revoke",
    "/api/auth/organization/list",
    "/api/auth/organization/set-active",
    "/api/auth/organization/get-full-organization",
    "/api/auth/two-factor/verify-totp",
    "/api/auth/passkey/generate-authenticate-options",
    "/api/auth/passkey/verify-authentication",
    "/api/auth/magic-link/verify",
    "/api/auth/callback/google",
    "/api/auth/oauth2/authorize",
    "/api/auth/oauth2/token",
    "/api/auth/oauth2/userinfo",
    "/api/auth/oauth2/end-session",
    "/api/auth/.well-known/openid-configuration",
    "/api/auth/jwks",
  ])("allows %s", (path) => {
    expect(isPlatformOnlyAuthPath(path)).toBe(false);
  });
});

describe("requestSessionTokens", () => {
  it("reads the bearer, the signed bearer and the session cookies", () => {
    const headers = new Headers({
      authorization: "Bearer plain-token",
      cookie: "theme=dark; __Secure-better-auth.session_token=cookie-token.sig%2Bnature; better-auth.session_data=ignored",
    });
    const tokens = requestSessionTokens(headers);
    expect(tokens).toContain("cookie-token");
    expect(tokens).toContain("plain-token");
    expect(requestSessionTokens(new Headers({ authorization: "Bearer signed.sig" }))).toContain("signed");
  });

  it("reads quoted and percent-encoded values the way Better Auth does", () => {
    expect(requestSessionTokens(new Headers({ cookie: 'better-auth.session_token="quoted.sig"' }))).toContain("quoted");
    expect(requestSessionTokens(new Headers({ cookie: "better-auth.session_token=enc%6Fded.sig" }))).toContain("encoded");
    expect(requestSessionTokens(new Headers({ authorization: "Bearer enc%6Fded.sig" }))).toContain("encoded");
  });

  it("ignores cookies that are not the session cookie", () => {
    expect(requestSessionTokens(new Headers({ cookie: "other.session_token=x; session_token=y" }))).toEqual([]);
  });
});

describe("carriesAppScopedSession", () => {
  it("is true when any credential on the request is app-scoped", async () => {
    const { db } = sessionDb(["app-token"]);
    expect(await carriesAppScopedSession(db, new Headers({ authorization: "Bearer app-token" }))).toBe(true);
    const mixed = new Headers({
      authorization: "Bearer platform-token",
      cookie: "better-auth.session_token=app-token.sig",
    });
    expect(await carriesAppScopedSession(db, mixed)).toBe(true);
  });

  it("is false for platform sessions and requests without credentials, without querying", async () => {
    const { db, queries } = sessionDb(["app-token"]);
    expect(await carriesAppScopedSession(db, new Headers({ authorization: "Bearer platform-token" }))).toBe(false);
    expect(await carriesAppScopedSession(db, new Headers())).toBe(false);
    expect(queries).toEqual([["platform-token"]]);
  });
});

describe("platformSessionOnly", () => {
  function appWith(db: D1Database) {
    const app = new Hono<{ Bindings: Env }>();
    app.use("/api/admin/*", platformSessionOnly);
    app.get("/api/admin/apps", () => Response.json({ apps: [] }));
    return (headers: HeadersInit) => app.request("/api/admin/apps", { headers }, { DB: db } as unknown as Env);
  }

  it("turns an app-scoped bearer away before the handler runs", async () => {
    const response = await appWith(sessionDb(["app-token"]).db)({ authorization: "Bearer app-token" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "platform_session_required" });
  });

  it("lets platform sessions and credential-less requests through", async () => {
    const request = appWith(sessionDb(["app-token"]).db);
    expect((await request({ authorization: "Bearer platform-token" })).status).toBe(200);
    expect((await request({ cookie: "better-auth.session_token=platform-token.sig" })).status).toBe(200);
    expect((await request({})).status).toBe(200);
  });

  it("answers 503 rather than letting the request through when the lookup fails", async () => {
    const response = await appWith(sessionDb([], true).db)({ authorization: "Bearer anything" });
    expect(response.status).toBe(503);
  });
});
