/**
 * applications.ts — CRUD helpers for the `application` table.
 *
 * Applications are registered SDK consumers (analogous to Clerk "applications").
 * Each one gets:
 *   - A publishable key  (pk_dev_* / pk_live_*) — safe to embed in client code
 *   - A secret key       (sk_dev_* / sk_live_*) — shown once, stored as a hash
 *   - An origin allowlist — replaces the hardcoded ALLOWED_ORIGINS set
 *   - A redirect URI allowlist — for OAuth callback validation
 *
 * The middleware layer validates the `X-Publishable-Key` header on every request
 * coming from an SDK consumer, then derives CORS + redirect-URI policy from the
 * matching row instead of the server-wide hardcoded lists.
 */

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
}

/** DB row as stored in D1 (origins/uris are newline-delimited strings). */
interface AppRow {
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
}

// ── Key generation ─────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random key with the given prefix.
 * Format: `{prefix}_{base62(32 random bytes)}`
 * e.g. `pk_dev_4aB9kLm2...`
 */
function generateKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (const b of bytes) {
    result += chars[b % chars.length];
  }
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

function rowToApp(row: AppRow): Application {
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
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function listApplications(db: D1Database): Promise<Application[]> {
  const result = await db
    .prepare(
      `SELECT id, name, environment, publishable_key, secret_key_hash,
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt
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
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt
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
              allowed_origins, redirect_uris, createdBy, createdAt, updatedAt
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
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO application
         (id, name, environment, publishable_key, secret_key_hash,
          allowed_origins, redirect_uris, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, input.name, input.environment,
      publishableKey, secretHash,
      input.allowed_origins.join("\n"),
      input.redirect_uris.join("\n"),
      input.createdBy,
      now, now
    )
    .run();

  const app = await getApplicationById(db, id);
  return { app: app!, rawSecretKey };
}

export interface UpdateApplicationInput {
  name?: string;
  allowed_origins?: string[];
  redirect_uris?: string[];
}

export async function updateApplication(
  db: D1Database,
  id: string,
  input: UpdateApplicationInput
): Promise<Application | null> {
  const now = Date.now();
  const sets: string[] = ["updatedAt = ?"];
  const bindings: (string | number)[] = [now];

  if (input.name !== undefined) {
    sets.push("name = ?");
    bindings.push(input.name);
  }
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

  return getApplicationById(db, id);
}

export async function deleteApplication(db: D1Database, id: string): Promise<void> {
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

/**
 * Returns true if the given origin is allowed by the application.
 * Also returns true if the app has no origin restrictions (empty list) so
 * that newly created apps work before origins are configured.
 */
export function isOriginAllowed(app: Application, origin: string): boolean {
  if (app.allowed_origins.length === 0) return true; // unrestricted
  return app.allowed_origins.some(o => o === origin);
}

/**
 * Returns true if the given redirect URI is in the app's allowlist.
 * Performs prefix matching so "/dashboard/callback" matches
 * "https://app.example.com/dashboard/callback".
 */
export function isRedirectUriAllowed(app: Application, uri: string): boolean {
  if (app.redirect_uris.length === 0) return true; // unrestricted
  return app.redirect_uris.some(allowed => uri.startsWith(allowed));
}
