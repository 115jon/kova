/**
 * plan-limits.ts — Plan definitions, feature flags, and enforcement helpers.
 *
 * Plans mirror Clerk's billing model: each plan gates user/org counts and
 * feature capabilities (branding, custom SMTP, audit logs, etc.).
 * Enforcement happens at the SDK middleware layer (session create / org create)
 * using a KV-cached plan lookup to avoid D1 reads on every request.
 */

// ── Plan definitions ─────────────────────────────────────────────────────────

export type Plan = "free" | "starter" | "pro" | "enterprise";

export type Feature =
  | "branding"
  | "custom_smtp"
  | "orgs"
  | "audit_logs"
  | "sso"
  | "api_keys";

export interface PlanLimits {
  users: number;   // -1 = unlimited
  orgs: number;    // -1 = unlimited
  features: Feature[];
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    users: 100,
    orgs: 0,         // no orgs on Free
    features: [],
  },
  starter: {
    users: 1_000,
    orgs: 5,
    features: ["branding", "api_keys"],
  },
  pro: {
    users: 10_000,
    orgs: 50,
    features: ["branding", "api_keys", "custom_smtp", "orgs", "audit_logs"],
  },
  enterprise: {
    users: -1,
    orgs: -1,
    features: ["branding", "api_keys", "custom_smtp", "orgs", "audit_logs", "sso"],
  },
} as const;

// ── Stripe price IDs (set in production via wrangler secret put) ──────────────

export const STRIPE_PLANS: Array<{
  id: Plan;
  name: string;
  priceIdEnvKey: string;
}> = [
    { id: "starter", name: "Starter", priceIdEnvKey: "STRIPE_PRICE_STARTER" },
    { id: "pro", name: "Pro", priceIdEnvKey: "STRIPE_PRICE_PRO" },
    { id: "enterprise", name: "Enterprise", priceIdEnvKey: "STRIPE_PRICE_ENTERPRISE" },
  ];

// ── KV cache key helpers ──────────────────────────────────────────────────────

/** KV key for cached { plan, userCount } per app (60s TTL). */
export function planCacheKey(appId: string): string {
  return `plan:${appId}`;
}

interface PlanCache {
  plan: Plan;
  userCount: number;
  orgCount: number;
}

// ── Enforcement helpers ───────────────────────────────────────────────────────

/**
 * Throws a 402 error if the application has reached its user limit for the
 * current plan. Uses KV as a write-through cache to avoid D1 on every sign-up.
 */
export async function assertCanAddUser(
  db: D1Database,
  kv: KVNamespace,
  appId: string
): Promise<void> {
  const cached = await kv.get<PlanCache>(planCacheKey(appId), "json").catch(() => null);

  const plan: Plan = cached?.plan ?? await getAppPlan(db, appId);
  const limit = PLAN_LIMITS[plan].users;
  if (limit === -1) return; // enterprise = unlimited

  const userCount: number = cached?.userCount ?? await countAppUsers(db, appId);

  // Refresh KV cache (fire-and-forget)
  kv.put(
    planCacheKey(appId),
    JSON.stringify({ plan, userCount, orgCount: cached?.orgCount ?? 0 }),
    { expirationTtl: 60 }
  ).catch(() => { });

  if (userCount >= limit) {
    throw Object.assign(
      new Error(
        `User limit reached (${userCount}/${limit}). Upgrade your plan to add more users.`
      ),
      { code: "PLAN_LIMIT_USERS", status: 402 }
    );
  }
}

/**
 * Throws a 402 error if the application has reached its org limit.
 */
export async function assertCanAddOrg(
  db: D1Database,
  kv: KVNamespace,
  appId: string
): Promise<void> {
  const cached = await kv.get<PlanCache>(planCacheKey(appId), "json").catch(() => null);

  const plan: Plan = cached?.plan ?? await getAppPlan(db, appId);
  const limit = PLAN_LIMITS[plan].orgs;
  if (limit === -1) return;

  if (limit === 0) {
    throw Object.assign(
      new Error("Organizations are not available on the Free plan. Upgrade to Starter or above."),
      { code: "PLAN_LIMIT_ORGS", status: 402 }
    );
  }

  const orgCount: number = cached?.orgCount ?? await countAppOrgs(db, appId);

  kv.put(
    planCacheKey(appId),
    JSON.stringify({ plan, userCount: cached?.userCount ?? 0, orgCount }),
    { expirationTtl: 60 }
  ).catch(() => { });

  if (orgCount >= limit) {
    throw Object.assign(
      new Error(
        `Organization limit reached (${orgCount}/${limit}). Upgrade your plan to create more organizations.`
      ),
      { code: "PLAN_LIMIT_ORGS", status: 402 }
    );
  }
}

/**
 * Returns true if the application's plan includes the given feature.
 * Uses KV-cached plan data when available.
 */
export async function hasFeature(
  db: D1Database,
  kv: KVNamespace,
  appId: string,
  feature: Feature
): Promise<boolean> {
  const cached = await kv.get<PlanCache>(planCacheKey(appId), "json").catch(() => null);
  const plan: Plan = cached?.plan ?? await getAppPlan(db, appId);
  const featureList = PLAN_LIMITS[plan].features;
  return featureList.includes(feature);
}

/** Returns the current plan for an app (D1 lookup). */
async function getAppPlan(db: D1Database, appId: string): Promise<Plan> {
  const row = await db
    .prepare(`SELECT plan FROM application WHERE id = ? LIMIT 1`)
    .bind(appId)
    .first<{ plan: string }>()
    .catch(() => null);
  return (row?.plan as Plan) ?? "free";
}

async function countAppUsers(db: D1Database, appId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM app_user WHERE app_id = ?`)
    .bind(appId)
    .first<{ n: number }>()
    .catch(() => null);
  return row?.n ?? 0;
}

async function countAppOrgs(db: D1Database, appId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM organization WHERE app_id = ?`)
    .bind(appId)
    .first<{ n: number }>()
    .catch(() => null);
  return row?.n ?? 0;
}

/** Synchronises `app_plan_feature` rows after a plan change. */
export async function syncPlanFeatures(
  db: D1Database,
  appId: string,
  plan: Plan
): Promise<void> {
  const features = PLAN_LIMITS[plan].features;
  const allFeatures: Feature[] = [
    "branding", "custom_smtp", "orgs", "audit_logs", "sso", "api_keys",
  ];

  const stmts = allFeatures.map((f) =>
    db.prepare(
      `INSERT INTO app_plan_feature (app_id, feature, enabled)
       VALUES (?, ?, ?)
       ON CONFLICT (app_id, feature) DO UPDATE SET enabled = excluded.enabled`
    ).bind(appId, f, features.includes(f) || plan === "enterprise" ? 1 : 0)
  );

  // D1 batch for efficiency
  await db.batch(stmts);
}
