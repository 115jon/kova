/**
 * org-settings.ts — Organization settings helpers
 *
 * Provides typed D1 access for the `organization_settings` table introduced
 * in migration 0012. The table is lazily created (no row = all defaults off).
 *
 * Used by:
 *   - databaseHooks.session.create.before → MFA enforcement check
 *   - Custom admin API endpoints           → toggle require_mfa
 */

import { generateId } from "better-auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrgSettings {
  orgId: string;
  require_mfa: boolean;
  createdAt: number;
  updatedAt: number;
}

// D1 raw row (all values INTEGER / TEXT)
interface OrgSettingsRow {
  orgId: string;
  require_mfa: number; // 0 | 1
  createdAt: number;
  updatedAt: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get the settings object for an org. Returns defaults (all false) if no row
 * exists — this avoids requiring a write on every org creation.
 */
export async function getOrgSettings(
  db: D1Database,
  orgId: string
): Promise<OrgSettings> {
  const row = await db
    .prepare(
      "SELECT orgId, require_mfa, createdAt, updatedAt FROM organization_settings WHERE orgId = ? LIMIT 1"
    )
    .bind(orgId)
    .first<OrgSettingsRow>()
    .catch(() => null);

  if (!row) {
    return {
      orgId,
      require_mfa: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return {
    orgId: row.orgId,
    require_mfa: row.require_mfa === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Upsert the `require_mfa` flag for an org. Creates the row if absent.
 */
export async function setRequireMFA(
  db: D1Database,
  orgId: string,
  requireMFA: boolean
): Promise<void> {
  const now = Date.now();
  const val = requireMFA ? 1 : 0;
  await db
    .prepare(`
      INSERT INTO organization_settings (orgId, require_mfa, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(orgId) DO UPDATE SET
        require_mfa = excluded.require_mfa,
        updatedAt   = excluded.updatedAt
    `)
    .bind(orgId, val, now, now)
    .run();
}

// ── MFA enforcement check ─────────────────────────────────────────────────────

/**
 * Returns the org ID for which MFA enforcement should block the given user's
 * session creation, or null if there's no block.
 *
 * Logic:
 *   1. If the user is not a member of any org that requires MFA → no block.
 *   2. If the user is a member of an org that requires MFA but does NOT have
 *      2FA enabled → return that org's ID so the caller can throw.
 *
 * Note: We only check the *first* org that requires MFA for simplicity.
 * A more thorough implementation would check all orgs the user belongs to.
 */
export async function findMFAEnforcedOrgBlockingUser(
  db: D1Database,
  userId: string
): Promise<string | null> {
  // Step 1: does this user have 2FA already enabled?
  const userRow = await db
    .prepare('SELECT twoFactorEnabled FROM "user" WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ twoFactorEnabled: number | null }>()
    .catch(() => null);

  // Cast: D1 stores booleans as 0/1; the TypeScript type says number|null|undefined.
  const has2FA = Number(userRow?.twoFactorEnabled) === 1;

  if (has2FA) {
    // User already has 2FA — no block regardless of org settings
    return null;
  }

  // Step 2: find orgs the user belongs to that have require_mfa = 1
  const blockingOrg = await db
    .prepare(`
      SELECT os.orgId
      FROM organization_settings os
      INNER JOIN member m ON m.organizationId = os.orgId
      WHERE m.userId = ?
        AND os.require_mfa = 1
      LIMIT 1
    `)
    .bind(userId)
    .first<{ orgId: string }>()
    .catch(() => null);

  return blockingOrg?.orgId ?? null;
}

// ── Domain auto-join helpers ───────────────────────────────────────────────────

export interface OrgDomain {
  id: string;
  orgId: string;
  domain: string;
  enrollment_mode: "automatic_invitation" | "automatic_join";
  verification_token: string | null;
  verified: boolean;
  verified_at: number | null;
  default_role: string;
  createdAt: number;
  updatedAt: number;
}

interface OrgDomainRow {
  id: string;
  orgId: string;
  domain: string;
  enrollment_mode: string;
  verification_token: string | null;
  verified: number;
  verified_at: number | null;
  default_role: string;
  createdAt: number;
  updatedAt: number;
}

function rowToDomain(row: OrgDomainRow): OrgDomain {
  return {
    ...row,
    enrollment_mode: row.enrollment_mode as OrgDomain["enrollment_mode"],
    verified: row.verified === 1,
  };
}

/**
 * List all domains configured for an org.
 */
export async function listOrgDomains(
  db: D1Database,
  orgId: string
): Promise<OrgDomain[]> {
  const result = await db
    .prepare(
      "SELECT * FROM organization_domain WHERE orgId = ? ORDER BY createdAt ASC"
    )
    .bind(orgId)
    .all<OrgDomainRow>()
    .catch(() => ({ results: [] as OrgDomainRow[] }));
  return result.results.map(rowToDomain);
}

/**
 * Add a new domain to an org's verified domain list.
 * Generates a random verification token for DNS TXT record placement.
 */
export async function addOrgDomain(
  db: D1Database,
  opts: {
    orgId: string;
    domain: string;
    enrollment_mode?: OrgDomain["enrollment_mode"];
    default_role?: string;
  }
): Promise<OrgDomain> {
  const id = generateId();
  const token = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  await db
    .prepare(`
      INSERT INTO organization_domain
        (id, orgId, domain, enrollment_mode, verification_token, verified, default_role, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `)
    .bind(
      id,
      opts.orgId,
      opts.domain.toLowerCase(),
      opts.enrollment_mode ?? "automatic_invitation",
      token,
      opts.default_role ?? "member",
      now,
      now
    )
    .run();

  return {
    id,
    orgId: opts.orgId,
    domain: opts.domain.toLowerCase(),
    enrollment_mode: opts.enrollment_mode ?? "automatic_invitation",
    verification_token: token,
    verified: false,
    verified_at: null,
    default_role: opts.default_role ?? "member",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Remove a domain from an org.
 */
export async function removeOrgDomain(
  db: D1Database,
  id: string,
  orgId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM organization_domain WHERE id = ? AND orgId = ?")
    .bind(id, orgId)
    .run();
}

/**
 * Mark a domain as verified (called after DNS TXT check passes).
 */
export async function verifyOrgDomain(
  db: D1Database,
  id: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE organization_domain SET verified = 1, verified_at = ?, updatedAt = ? WHERE id = ?"
    )
    .bind(Date.now(), Date.now(), id)
    .run();
}

/**
 * Look up the org domain record for a given email domain.
 * Returns null if no verified, auto-join domain is configured.
 */
export async function findAutoJoinDomainForEmail(
  db: D1Database,
  email: string
): Promise<OrgDomain | null> {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return null;
  const domain = email.slice(atIndex + 1).toLowerCase();

  const row = await db
    .prepare(`
      SELECT * FROM organization_domain
      WHERE domain = ?
        AND verified = 1
      LIMIT 1
    `)
    .bind(domain)
    .first<OrgDomainRow>()
    .catch(() => null);

  return row ? rowToDomain(row) : null;
}
