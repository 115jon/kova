/**
 * A real worker (Hono + Better Auth) over the migrated in-memory D1 and KV,
 * for end-to-end route tests. Users and sessions are inserted straight into
 * SQLite; the session cookie is signed the way Better Auth signs it.
 * Test code only.
 */
import { generateSignedCookie } from "hono/cookie";
import type { DatabaseSync } from "node:sqlite";
import worker from "../index";
import { memoryKV, migratedD1 } from "./d1";

export const TEST_SECRET = "test-secret-test-secret-test-secret-12345";
export const TEST_AUTH_URL = "https://auth.115jon.site";
export const SESSION_COOKIE = "__Secure-better-auth.session_token";

export type Harness = ReturnType<typeof createHarness>;

export function createHarness(options: { env?: Partial<Env>; beforeMigration?: Record<string, (sqlite: DatabaseSync) => void> } = {}) {
  const { sqlite, db } = migratedD1({ beforeMigration: options.beforeMigration });
  const { kv, store } = memoryKV();
  const env = {
    AUTH_URL: TEST_AUTH_URL,
    DASHBOARD_URL: TEST_AUTH_URL,
    BETTER_AUTH_SECRET: TEST_SECRET,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    RESEND_API_KEY: "re_unused",
    CDN_URL: "https://cdn.example",
    DB: db,
    KV: kv,
    APP_COUNTER: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => new Response(null) }),
    },
    ...options.env,
  } as unknown as Env;
  const background: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  let users = 0;

  return {
    sqlite,
    db,
    kv,
    kvStore: store,
    env,
    /** Waits for everything handed to ctx.waitUntil so far. */
    async settle() {
      await Promise.allSettled(background.splice(0));
    },
    fetch(input: string | Request, init?: RequestInit) {
      const request = typeof input === "string" ? new Request(new URL(input, TEST_AUTH_URL), init) : input;
      // The Workers runtime always sends Host; the subdomain dispatch reads it.
      if (!request.headers.has("host")) request.headers.set("host", new URL(request.url).host);
      return Promise.resolve(worker.fetch(request, env, ctx));
    },
    createUser(fields: { name?: string; email?: string; username?: string | null; image?: string | null; role?: string } = {}) {
      users += 1;
      const id = `user_${users}_${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date("2026-09-01T12:00:00.000Z").toISOString();
      sqlite.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt, role, username)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        fields.name ?? "Ada Lovelace",
        fields.email ?? `ada${users}@example.com`,
        fields.image ?? null,
        now,
        now,
        fields.role ?? "user",
        fields.username ?? null,
      );
      return { id, updatedAt: now };
    },
    createApp(fields: { id?: string; name?: string; publishableKey?: string; authSlug?: string | null; allowedOrigins?: string[]; suspended?: boolean } = {}) {
      const id = fields.id ?? `app_${crypto.randomUUID().slice(0, 8)}`;
      const publishableKey = fields.publishableKey ?? `pk_dev_${crypto.randomUUID().replace(/-/g, "")}`;
      sqlite.prepare(
        `INSERT INTO application (id, name, publishable_key, secret_key_hash, allowed_origins, redirect_uris, auth_slug, suspended_at)
         VALUES (?, ?, ?, 'unused', ?, '', ?, ?)`,
      ).run(
        id,
        fields.name ?? "Ralph Meet",
        publishableKey,
        (fields.allowedOrigins ?? []).join(String.fromCharCode(10)),
        fields.authSlug === undefined ? `slug-${id.slice(4)}` : fields.authSlug,
        fields.suspended ? Date.now() : null,
      );
      return { id, publishableKey, authSlug: fields.authSlug === undefined ? `slug-${id.slice(4)}` : fields.authSlug };
    },
    /** A session row plus the signed cookie header that carries it. */
    async createSession(userId: string, options: { appId?: string | null } = {}) {
      const id = `sess_${crypto.randomUUID()}`;
      const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
      const now = Date.now();
      sqlite.prepare(
        `INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        token,
        new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        options.appId ?? null,
      );
      const setCookie = await generateSignedCookie(SESSION_COOKIE, token, TEST_SECRET, { secure: true, path: "/" });
      return { id, token, cookie: setCookie.split(";")[0]! };
    },
  };
}

/** Verifies an RS256 JWT against a JWKS document. Returns header + payload. */
export async function verifyRs256(jwt: string, jwks: { keys: Array<JsonWebKey & { kid?: string }> }) {
  const [rawHeader, rawPayload, rawSignature] = jwt.split(".");
  if (!rawHeader || !rawPayload || !rawSignature) throw new Error("malformed JWT");
  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  const header = decode(rawHeader) as { alg: string; kid?: string };
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error(`no JWK for kid ${header.kid}`);
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(rawSignature, "base64url"),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!valid) throw new Error("bad signature");
  return { header, payload: decode(rawPayload) as Record<string, unknown> };
}
