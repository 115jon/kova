/**
 * applications.ts — CRUD helpers for the `application` table.
 *
 * Applications are registered SDK consumers (analogous to Clerk "applications").
 * Each one gets:
 *   - A publishable key  (pk_dev_* / pk_live_*) — safe to embed in client code
 *   - A secret key       (sk_dev_* / sk_live_*) — shown once, stored as a hash
 *   - An origin allowlist — replaces the hardcoded ALLOWED_ORIGINS set
 *   - A redirect URI allowlist — for OAuth callback validation
 *   - Branding settings  — logo, favicon, colors, theme (served to SDK sign-in card)
 *   - Email settings     — from_name, from_email, per-app SMTP config
 *   - Billing fields     — plan, Stripe customer/subscription IDs
 *
 * The middleware layer validates the `X-Publishable-Key` header on every request
 * coming from an SDK consumer, then derives CORS + redirect-URI policy from the
 * matching row instead of the server-wide hardcoded lists.
 *
 * Plan + appearance data is KV-cached to avoid D1 on every SDK request.
 *   KV key: `appearance:{publishable_key}` (TTL: 5 min)
 *   KV key: `plan:{app_id}`               (TTL: 60 s)
 */

import { generateAuthSlug } from "./lib/slugify";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  name: string;
  environment: "development" | "production";
  publishable_key: string;
  /** The raw secret — only present immediately after creation, never persisted. */
  secret_key?: string;
  allowed_origins: string[];
  redirect_uris: string[];
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  // ── Branding / Appearance (migration 0014)
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  background_color: string;
  theme: "dark" | "light" | "auto";
  home_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  hide_branding: boolean;
  // ── Email sender identity
  from_name: string | null;
  from_email: string | null;
  support_email: string | null;
  // ── Per-app SMTP (Pro+)
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_secure: boolean;
  // smtp_pass_enc intentionally omitted from the public shape — never returned to API consumers
  // ── Billing
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: "free" | "starter" | "pro" | "enterprise";
  plan_expires_at: number | null;
  // ── Platform lifecycle
  suspended_at: number | null;
  // ── Auth subdomain (migration 0018)
  /** Auto-generated immutable slug: {slug}.auth.115jon.site */
  auth_slug: string | null;
  /** Optional custom domain alias (e.g. login.mycompany.com) */
  custom_domain: string | null;
}

/** DB row as stored in D1 (origins/uris are newline-delimited strings). */
export interface AppRow {
  id: string;
  name: string;
  environment: string;
  publishable_key: string;
  secret_key_hash: string;
  allowed_origins: string;
  redirect_uris: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  // Branding
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  background_color: string | null;
  theme: string | null;
  home_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  hide_branding: number | null;
  // Email
  from_name: string | null;
  from_email: string | null;
  support_email: string | null;
  // SMTP
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_secure: number | null;
  // Billing
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  plan_expires_at: number | null;
  // Lifecycle
  suspended_at: number | null;
  // Auth subdomain (migration 0018)
  auth_slug: string | null;
  custom_domain: string | null;
}

// ── Key generation ─────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random key with the given prefix.
 * Format: `{prefix}_{base62(32 random bytes)}`
 * e.g. `pk_dev_4aB9kLm2...`
 */
export function generateKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const result = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${prefix}_${result}`;
}

/**
 * One-way HMAC of the secret key using the env secret as the signing key.
 * This is intentionally NOT bcrypt (Workers runtime doesn't have it) but uses
 * HMAC-SHA256 which is acceptable for server-side secret validation since the
 * secret has 144 bits of entropy.
 */
async function hashSecret(raw: string, signingSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifySecret(raw: string, stored: string, signingSecret: string): Promise<boolean> {
  const computed = await hashSecret(raw, signingSecret);
  // Constant-time compare
  if (computed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

// ── Row transformer ────────────────────────────────────────────────────────────

export function rowToApp(row: AppRow): Application {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment as "development" | "production",
    publishable_key: row.publishable_key,
    allowed_origins: row.allowed_origins
      ? row.allowed_origins.split("\n").map(s => s.trim()).filter(Boolean)
      : [],
    redirect_uris: row.redirect_uris
      ? row.redirect_uris.split("\n").map(s => s.trim()).filter(Boolean)
      : [],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Branding
    display_name: row.display_name ?? null,
    logo_url: row.logo_url ?? null,
    favicon_url: row.favicon_url ?? null,
    primary_color: row.primary_color ?? "#3b82f6",
    background_color: row.background_color ?? "#0f172a",
    theme: (row.theme ?? "dark") as "dark" | "light" | "auto",
    home_url: row.home_url ?? null,
    terms_url: row.terms_url ?? null,
    privacy_url: row.privacy_url ?? null,
    hide_branding: Boolean(row.hide_branding),
    // Email
    from_name: row.from_name ?? null,
    from_email: row.from_email ?? null,
    support_email: row.support_email ?? null,
    // SMTP
    smtp_host: row.smtp_host ?? null,
    smtp_port: row.smtp_port ?? 587,
    smtp_user: row.smtp_user ?? null,
    smtp_secure: Boolean(row.smtp_secure),
    // Billing
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    plan: (row.plan ?? "free") as "free" | "starter" | "pro" | "enterprise",
    plan_expires_at: row.plan_expires_at ?? null,
    // Lifecycle
    suspended_at: row.suspended_at ?? null,
    // Auth subdomain
    auth_slug: row.auth_slug ?? null,
    custom_domain: row.custom_domain ?? null,
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function listApplications(db: D1Database): Promise<Application[]> {
  const result = await db
    .prepare(
      `SELECT id, name, environment, publishable_key, secret_key_hash,
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt,
              display_name, logo_url, favicon_url, primary_color, background_color,
              theme, home_url, terms_url, privacy_url, hide_branding,
              from_name, from_email, support_email,
              smtp_host, smtp_port, smtp_user, smtp_secure,
              stripe_customer_id, stripe_subscription_id, plan, plan_expires_at,
              suspended_at, auth_slug, custom_domain
       FROM application ORDER BY createdAt DESC`
    )
    .all<AppRow>();
  return (result.results ?? []).map(rowToApp);
}

export async function getApplicationByPublishableKey(
  db: D1Database,
  publishableKey: string
): Promise<Application | null> {
  const row = await db
    .prepare(
      `SELECT id, name, environment, publishable_key, secret_key_hash,
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt,
              display_name, logo_url, favicon_url, primary_color, background_color,
              theme, home_url, terms_url, privacy_url, hide_branding,
              from_name, from_email, support_email,
              smtp_host, smtp_port, smtp_user, smtp_secure,
              stripe_customer_id, stripe_subscription_id, plan, plan_expires_at,
              suspended_at, auth_slug, custom_domain
       FROM application WHERE publishable_key = ? LIMIT 1`
    )
    .bind(publishableKey)
    .first<AppRow>();
  return row ? rowToApp(row) : null;
}

export async function getApplicationById(
  db: D1Database,
  id: string
): Promise<Application | null> {
  const row = await db
    .prepare(
      `SELECT id, name, environment, publishable_key, secret_key_hash,
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt,
              display_name, logo_url, favicon_url, primary_color, background_color,
              theme, home_url, terms_url, privacy_url, hide_branding,
              from_name, from_email, support_email,
              smtp_host, smtp_port, smtp_user, smtp_secure,
              stripe_customer_id, stripe_subscription_id, plan, plan_expires_at,
              suspended_at, auth_slug, custom_domain
       FROM application WHERE id = ? LIMIT 1`
    )
    .bind(id)
    .first<AppRow>();
  return row ? rowToApp(row) : null;
}

export interface CreateApplicationInput {
  name: string;
  environment: "development" | "production";
  allowed_origins: string[];
  redirect_uris: string[];
  createdBy: string;
  signingSecret: string; // BETTER_AUTH_SECRET from env — used to HMAC the sk
}

export interface CreateApplicationResult {
  app: Application;
  /** Raw secret key — returned ONCE, never stored in plaintext. */
  rawSecretKey: string;
}

export async function createApplication(
  db: D1Database,
  input: CreateApplicationInput
): Promise<CreateApplicationResult> {
  const envPrefix = input.environment === "production" ? "live" : "dev";
  const id = `app_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const publishableKey = generateKey(`pk_${envPrefix}`);
  const rawSecretKey = generateKey(`sk_${envPrefix}`);
  const secretHash = await hashSecret(rawSecretKey, input.signingSecret);
  const authSlug = generateAuthSlug(input.name);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO application
         (id, name, environment, publishable_key, secret_key_hash,
          allowed_origins, redirect_uris, createdBy, createdAt, updatedAt, auth_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, input.name, input.environment,
      publishableKey, secretHash,
      input.allowed_origins.join("\n"),
      input.redirect_uris.join("\n"),
      input.createdBy,
      now, now,
      authSlug
    )
    .run();

  const app = await getApplicationById(db, id);
  return { app: app!, rawSecretKey };
}

export interface UpdateApplicationInput {
  name?: string;
  allowed_origins?: string[];
  redirect_uris?: string[];
  // Branding
  display_name?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  background_color?: string;
  theme?: "dark" | "light" | "auto";
  hide_branding?: boolean;
  home_url?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  // Email identity
  from_name?: string | null;
  from_email?: string | null;
  support_email?: string | null;
  // SMTP (Pro+) — pass null fields to clear
  smtp_host?: string | null;
  smtp_port?: number;
  smtp_user?: string | null;
  smtp_pass_enc?: string | null;  // already encrypted by caller
  smtp_secure?: boolean;
  // Auth subdomain — only custom_domain is mutable; auth_slug is immutable
  custom_domain?: string | null;
}

export async function updateApplication(
  db: D1Database,
  id: string,
  input: UpdateApplicationInput,
  kv?: KVNamespace
): Promise<Application | null> {
  const now = Date.now();
  const sets: string[] = ["updatedAt = ?"];
  const bindings: (string | number | null)[] = [now];

  // Helper to conditionally push a field
  const addField = (col: string, val: string | number | boolean | null | undefined) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    bindings.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
  };

  addField("name", input.name);
  addField("display_name", input.display_name);
  addField("logo_url", input.logo_url);
  addField("favicon_url", input.favicon_url);
  addField("primary_color", input.primary_color);
  addField("background_color", input.background_color);
  addField("theme", input.theme);
  addField("hide_branding", input.hide_branding);
  addField("home_url", input.home_url);
  addField("terms_url", input.terms_url);
  addField("privacy_url", input.privacy_url);
  addField("from_name", input.from_name);
  addField("from_email", input.from_email);
  addField("support_email", input.support_email);
  addField("smtp_host", input.smtp_host);
  addField("smtp_port", input.smtp_port);
  addField("smtp_user", input.smtp_user);
  addField("smtp_pass_enc", input.smtp_pass_enc);
  addField("smtp_secure", input.smtp_secure);
  addField("custom_domain", input.custom_domain);

  if (input.allowed_origins !== undefined) {
    sets.push("allowed_origins = ?");
    bindings.push(input.allowed_origins.join("\n"));
  }
  if (input.redirect_uris !== undefined) {
    sets.push("redirect_uris = ?");
    bindings.push(input.redirect_uris.join("\n"));
  }

  await db
    .prepare(`UPDATE application SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...bindings, id)
    .run();

  const updated = await getApplicationById(db, id);

  // Invalidate subdomain KV caches — fire-and-forget.
  // Keys mirror the patterns in lib/subdomain.ts.
  if (kv && updated?.auth_slug) kv.delete(`slug:${updated.auth_slug}`).catch(() => { });
  if (kv && updated?.custom_domain) kv.delete(`domain:${updated.custom_domain}`).catch(() => { });
  // Also bust the OLD custom_domain if it changed
  if (kv && input.custom_domain !== undefined && input.custom_domain !== updated?.custom_domain) {
    kv.delete(`domain:${input.custom_domain}`).catch(() => { });
  }

  return updated;
}

export async function deleteApplication(db: D1Database, id: string, kv?: KVNamespace): Promise<void> {
  // Read the slug before deletion so we can invalidate the KV cache
  if (kv) {
    const app = await getApplicationById(db, id).catch(() => null);
    if (app?.auth_slug) kv.delete(`slug:${app.auth_slug}`).catch(() => { });
    if (app?.custom_domain) kv.delete(`domain:${app.custom_domain}`).catch(() => { });
  }
  await db.prepare(`DELETE FROM application WHERE id = ?`).bind(id).run();
}

/**
 * Rotates the secret key for an application.
 * Returns the new raw secret — show it to the user once, then it's gone.
 */
export async function rotateSecretKey(
  db: D1Database,
  id: string,
  signingSecret: string
): Promise<string> {
  const envRow = await db
    .prepare(`SELECT environment FROM application WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ environment: string }>();
  if (!envRow) throw new Error("Application not found");

  const envPrefix = envRow.environment === "production" ? "live" : "dev";
  const newRawKey = generateKey(`sk_${envPrefix}`);
  const newHash = await hashSecret(newRawKey, signingSecret);

  await db
    .prepare(`UPDATE application SET secret_key_hash = ?, updatedAt = ? WHERE id = ?`)
    .bind(newHash, Date.now(), id)
    .run();

  return newRawKey;
}

/**
 * Validates a secret key against a stored application.
 * Used for server-to-server calls where the full sk is provided.
 */
export async function validateSecretKey(
  db: D1Database,
  appId: string,
  rawSecretKey: string,
  signingSecret: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT secret_key_hash FROM application WHERE id = ? LIMIT 1`)
    .bind(appId)
    .first<{ secret_key_hash: string }>();
  if (!row) return false;
  return verifySecret(rawSecretKey, row.secret_key_hash, signingSecret);
}

// ── Origin / redirect validation ───────────────────────────────────────────────

function isLocalhostUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function isApplicationSuspended(app: Pick<Application, "suspended_at">): boolean {
  return app.suspended_at !== null && app.suspended_at !== undefined;
}

export function isValidOrigin(value: string, environment: Application["environment"]): boolean {
  try {
    const u = new URL(value);
    if (u.origin !== value) return false;
    if (environment === "development" && isLocalhostUrl(value)) return true;
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidRedirectUri(value: string, environment: Application["environment"]): boolean {
  try {
    const u = new URL(value);
    if (environment === "development" && isLocalhostUrl(value)) return true;
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateApplicationPolicy(input: {
  environment: Application["environment"];
  allowed_origins: string[];
  redirect_uris: string[];
}): string | null {
  if (input.environment === "production") {
    if (input.allowed_origins.length === 0) return "production apps require at least one allowed origin";
    if (input.redirect_uris.length === 0) return "production apps require at least one redirect URI";
  }

  const invalidOrigin = input.allowed_origins.find((origin) => !isValidOrigin(origin, input.environment));
  if (invalidOrigin) return `invalid allowed origin: ${invalidOrigin}`;

  const invalidRedirect = input.redirect_uris.find((uri) => !isValidRedirectUri(uri, input.environment));
  if (invalidRedirect) return `invalid redirect URI: ${invalidRedirect}`;

  return null;
}

export function isRedirectUriAllowed(app: Application, uri: string): boolean {
  if (isApplicationSuspended(app)) return false;
  if (app.environment === "development" && isLocalhostUrl(uri)) return true;
  if (app.redirect_uris.length === 0) return app.environment === "development";

  let requested: URL;
  try {
    requested = new URL(uri);
  } catch {
    return false;
  }

  return app.redirect_uris.some((allowed) => {
    let registered: URL;
    try {
      registered = new URL(allowed);
    } catch {
      return false;
    }
    if (registered.origin !== requested.origin) return false;
    if (registered.pathname !== requested.pathname) return false;
    if (registered.search && registered.search !== requested.search) return false;
    return true;
  });
}

export function isOriginAllowed(app: Application, origin: string): boolean {
  if (isApplicationSuspended(app)) return false;
  if (app.environment === "development" && isLocalhostUrl(origin)) return true;
  if (app.allowed_origins.length === 0) return app.environment === "development";
  return app.allowed_origins.some(o => o === origin);
}
