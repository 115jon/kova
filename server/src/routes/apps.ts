import { Hono } from "hono";
import {
  createApplication,
  getApplicationById,
  listApplications,
  rotateSecretKey,
  updateApplication,
} from "../applications";
import { createAuth } from "../auth";
import { syncPlanFeatures } from "../lib/plan-limits";
import { hasAdminRole } from "../lib/roles";
import type { AppEventMessage } from "../queue-consumer";

const appsRouter = new Hono<{ Bindings: Env }>();

// ── Applications API ───────────────────────────────────────────────────────────
//
// All routes require admin role.
//
// GET    /                         → list all apps
// POST   /                         → create app (returns rawSecretKey ONCE)
// GET    /:id                      → get single app
// PATCH  /:id                      → update settings (name, origins, branding, email, smtp)
// DELETE /:id                      → hard-delete with typed-name confirmation + Queue cleanup
// POST   /:id/rotate-secret        → rotate secret key
// POST   /:id/suspend              → platform-level suspend
// POST   /:id/unsuspend            → remove suspension
// GET    /:id/stats                → user/org/login counts (AppCounter DO + D1 fallback)
// POST   /:id/logo                 → upload logo (multipart → R2 → update logo_url → KV invalidate)
// DELETE /:id/logo                 → remove logo
// POST   /:id/favicon              → upload favicon
// DELETE /:id/favicon              → remove favicon
// POST   /:id/billing/checkout     → Stripe Checkout URL
// POST   /:id/billing/portal       → Stripe Customer Portal URL
// GET    /:id/oauth-providers       → list per-app enabled OAuth providers
// PUT    /:id/oauth-providers       → set enabled OAuth providers

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAdmin(c: { req: { raw: Request }; env: Env }) {
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !hasAdminRole((session.user as { role?: string }).role)) {
    return null;
  }
  return session;
}

// ── KV cache invalidation helpers ─────────────────────────────────────────────

function invalidateAppKv(kv: KVNamespace, publishableKey: string, appId: string): void {
  kv.delete(`appearance:${publishableKey}`).catch(() => { });
  kv.delete(`plan:${appId}`).catch(() => { });
}

// ── LIST ──────────────────────────────────────────────────────────────────────

appsRouter.get("/", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const apps = await listApplications(c.env.DB);
  return Response.json({ apps });
});

// ── CREATE ───────────────────────────────────────────────────────────────────

appsRouter.post("/", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await c.req.raw.json()) as {
    name: string;
    environment: "development" | "production";
    allowed_origins: string[];
    redirect_uris: string[];
  };
  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const result = await createApplication(c.env.DB, {
    name: body.name,
    environment: body.environment ?? "development",
    allowed_origins: body.allowed_origins ?? [],
    redirect_uris: body.redirect_uris ?? [],
    createdBy: session.user.id,
    signingSecret: c.env.BETTER_AUTH_SECRET,
  });
  return Response.json(result, { status: 201 });
});

// ── GET SINGLE ───────────────────────────────────────────────────────────────

appsRouter.get("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const app = await getApplicationById(c.env.DB, c.req.param("id"));
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ app });
});

// ── UPDATE ───────────────────────────────────────────────────────────────────

appsRouter.patch("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const existing = await getApplicationById(c.env.DB, id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await c.req.raw.json()) as Record<string, unknown>;
  const app = await updateApplication(c.env.DB, id, {
    name: body.name as string | undefined,
    allowed_origins: body.allowed_origins as string[] | undefined,
    redirect_uris: body.redirect_uris as string[] | undefined,
    display_name: body.display_name as string | null | undefined,
    primary_color: body.primary_color as string | undefined,
    background_color: body.background_color as string | undefined,
    theme: body.theme as "dark" | "light" | "auto" | undefined,
    home_url: body.home_url as string | null | undefined,
    terms_url: body.terms_url as string | null | undefined,
    privacy_url: body.privacy_url as string | null | undefined,
    from_name: body.from_name as string | null | undefined,
    from_email: body.from_email as string | null | undefined,
    support_email: body.support_email as string | null | undefined,
    smtp_host: body.smtp_host as string | null | undefined,
    smtp_port: body.smtp_port as number | undefined,
    smtp_user: body.smtp_user as string | null | undefined,
    smtp_secure: body.smtp_secure as boolean | undefined,
  });
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  // Invalidate KV appearance cache
  invalidateAppKv(c.env.KV, existing.publishable_key, id);

  return Response.json({ app });
});

// ── HARD DELETE (Clerk-style with typed name confirmation) ────────────────────

appsRouter.delete("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  // Require typed name confirmation to match Clerk's UX
  const body = await c.req.raw.json().catch(() => ({})) as { confirmedName?: string };
  if (body.confirmedName !== app.name) {
    return Response.json(
      { error: `Name confirmation required. Type "${app.name}" exactly to delete.` },
      { status: 400 }
    );
  }

  // 1. Enqueue async side-effects (R2 cleanup, Stripe archival) — don't block
  const msg: AppEventMessage = {
    type: "app.deleted",
    appId: id,
    publishableKey: app.publishable_key,
    logoUrl: app.logo_url,
    faviconUrl: app.favicon_url,
    stripeCustomerId: app.stripe_customer_id,
    stripeSubscriptionId: app.stripe_subscription_id,
  };
  await c.env.APP_EVENTS.send(msg).catch(() => { });

  // 2. Sync KV invalidation immediately (don't wait for queue consumer)
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  // 3. Hard delete — ON DELETE CASCADE removes app_user, app_oauth_provider,
  //    app_email_template, app_plan_feature, and organization WHERE app_id = ?
  await c.env.DB.prepare("DELETE FROM application WHERE id = ?").bind(id).run();

  return Response.json({ ok: true });
});

// ── ROTATE SECRET ─────────────────────────────────────────────────────────────

appsRouter.post("/:id/rotate-secret", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const rawSecretKey = await rotateSecretKey(c.env.DB, c.req.param("id"), c.env.BETTER_AUTH_SECRET);
  return Response.json({ rawSecretKey });
});

// ── SUSPEND / UNSUSPEND ───────────────────────────────────────────────────────

appsRouter.post("/:id/suspend", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  await c.env.DB
    .prepare("UPDATE application SET suspended_at = ?, updatedAt = ? WHERE id = ?")
    .bind(Date.now(), Date.now(), id)
    .run();

  // Invalidate CORS + appearance cache so SDK requests are blocked immediately
  invalidateAppKv(c.env.KV, app.publishable_key, id);
  c.env.KV.delete(`cors:origin:${app.publishable_key}`).catch(() => { });

  return Response.json({ ok: true });
});

appsRouter.post("/:id/unsuspend", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  await c.env.DB
    .prepare("UPDATE application SET suspended_at = NULL, updatedAt = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();

  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ ok: true });
});

// ── STATS (AppCounter DO + D1 fallback) ───────────────────────────────────────

appsRouter.get("/:id/stats", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");

  // Try AppCounter DO first (accurate real-time counters)
  interface DoStats { total_users: number; total_orgs: number; logins_24h: number }
  let doStats: DoStats | null = null;
  try {
    const doId = c.env.APP_COUNTER.idFromName(id);
    const stub = c.env.APP_COUNTER.get(doId);
    const res = await stub.fetch("https://do/stats");
    if (res.ok) doStats = await res.json<DoStats>();
  } catch { /* DO unavailable in local dev without --remote */ }

  // D1 fallback counts (always accurate, slightly slower)
  const [userRow, orgRow, sessionRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_user WHERE app_id = ?").bind(id).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM organization WHERE app_id = ?").bind(id).first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM session WHERE app_id = ? AND expiresAt > ?"
    ).bind(id, Date.now()).first<{ n: number }>(),
  ]);

  // D1 is always the source of truth for stable counts.
  // The DO (APP_COUNTER) starts at 0 and is only incremented on new events,
  // so it under-counts for users who signed up before the DO was created, or
  // in local dev where the DO is reset between restarts.
  //
  // Only logins_24h needs the DO — it's a sliding-window counter that would
  // require a full table scan with a time-window filter in D1.
  const stats = {
    total_users: userRow?.n ?? 0,
    total_orgs: orgRow?.n ?? 0,
    logins_24h: doStats?.logins_24h ?? 0,
    active_sessions: sessionRow?.n ?? 0,
  };

  // Sync DO total counters from D1 when they're stale (fire-and-forget).
  // This corrects the DO after migrations or first-time deployments so
  // future increments start from the right baseline.
  if (doStats && (doStats.total_users < stats.total_users || doStats.total_orgs < stats.total_orgs)) {
    try {
      const doId = c.env.APP_COUNTER.idFromName(id);
      c.env.APP_COUNTER.get(doId).fetch("https://do/set", {
        method: "POST",
        body: JSON.stringify({ total_users: stats.total_users, total_orgs: stats.total_orgs }),
      }).catch(() => { });
    } catch { /* ignore — DO binding missing in local dev */ }
  }

  return Response.json({ stats });
});

// ── LOGO UPLOAD ───────────────────────────────────────────────────────────────

appsRouter.post("/:id/logo", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  const formData = await c.req.raw.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });

  // Validate size (max 2 MB)
  if (file.size > 2 * 1024 * 1024) {
    return Response.json({ error: "File too large (max 2 MB)" }, { status: 400 });
  }

  // Upload to CDN via multipart form
  const uploadForm = new FormData();
  uploadForm.append("file", file);
  uploadForm.append("path", `ralph-auth/apps/${id}/logo.webp`);

  const cdnRes = await fetch(`${c.env.CDN_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.CDN_API_KEY}` },
    body: uploadForm,
  });

  if (!cdnRes.ok) {
    const err = await cdnRes.text().catch(() => "Upload failed");
    return Response.json({ error: err }, { status: 502 });
  }

  const { url } = await cdnRes.json<{ url: string }>();

  // Persist URL + invalidate KV appearance cache
  await updateApplication(c.env.DB, id, { logo_url: url });
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ logoUrl: url });
});

appsRouter.delete("/:id/logo", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  await updateApplication(c.env.DB, id, { logo_url: null });
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ ok: true });
});

// ── FAVICON UPLOAD ────────────────────────────────────────────────────────────

appsRouter.post("/:id/favicon", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  const formData = await c.req.raw.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });

  if (file.size > 512 * 1024) {
    return Response.json({ error: "Favicon too large (max 512 KB)" }, { status: 400 });
  }

  const uploadForm = new FormData();
  uploadForm.append("file", file);
  uploadForm.append("path", `ralph-auth/apps/${id}/favicon.ico`);

  const cdnRes = await fetch(`${c.env.CDN_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.CDN_API_KEY}` },
    body: uploadForm,
  });

  if (!cdnRes.ok) {
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  const { url } = await cdnRes.json<{ url: string }>();
  await updateApplication(c.env.DB, id, { favicon_url: url });
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ faviconUrl: url });
});

appsRouter.delete("/:id/favicon", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  await updateApplication(c.env.DB, id, { favicon_url: null });
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ ok: true });
});

// ── BILLING: Stripe Checkout / Portal ─────────────────────────────────────────

appsRouter.post("/:id/billing/checkout", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!c.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Billing not configured" }, { status: 503 });
  }

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await c.req.raw.json().catch(() => ({})) as { priceId?: string };
  if (!body.priceId) return Response.json({ error: "priceId is required" }, { status: 400 });

  // Create Stripe customer if not already exists
  let customerId = app.stripe_customer_id;
  if (!customerId) {
    const custRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `email=${encodeURIComponent(session.user.email ?? "")}&name=${encodeURIComponent(app.name)}&metadata[app_id]=${id}`,
    });
    if (!custRes.ok) return Response.json({ error: "Failed to create Stripe customer" }, { status: 502 });
    const cust = await custRes.json<{ id: string }>();
    customerId = cust.id;
    await c.env.DB
      .prepare("UPDATE application SET stripe_customer_id = ?, updatedAt = ? WHERE id = ?")
      .bind(customerId, Date.now(), id)
      .run();
  }

  const dashUrl = c.env.DASHBOARD_URL;
  const checkoutRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: [
      `customer=${customerId}`,
      `line_items[0][price]=${body.priceId}`,
      `line_items[0][quantity]=1`,
      `mode=subscription`,
      `success_url=${encodeURIComponent(`${dashUrl}/applications/${id}?tab=billing&checkout=success`)}`,
      `cancel_url=${encodeURIComponent(`${dashUrl}/applications/${id}?tab=billing`)}`,
      `metadata[app_id]=${id}`,
      `subscription_data[metadata][app_id]=${id}`,
    ].join("&"),
  });

  if (!checkoutRes.ok) return Response.json({ error: "Failed to create checkout session" }, { status: 502 });
  const checkout = await checkoutRes.json<{ url: string }>();
  return Response.json({ url: checkout.url });
});

appsRouter.post("/:id/billing/portal", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!c.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Billing not configured" }, { status: 503 });
  }

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app?.stripe_customer_id) {
    return Response.json({ error: "No billing account found" }, { status: 404 });
  }

  const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: [
      `customer=${app.stripe_customer_id}`,
      `return_url=${encodeURIComponent(`${c.env.DASHBOARD_URL}/applications/${id}?tab=billing`)}`,
    ].join("&"),
  });

  if (!portalRes.ok) return Response.json({ error: "Failed to create portal session" }, { status: 502 });
  const portal = await portalRes.json<{ url: string }>();
  return Response.json({ url: portal.url });
});

// ── STRIPE WEBHOOK (plan update) ─────────────────────────────────────────────

appsRouter.post("/billing/webhook", async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Not configured" }, { status: 503 });
  }

  const sig = c.req.raw.headers.get("stripe-signature") ?? "";
  const body = await c.req.raw.text();

  // Lightweight HMAC-SHA256 Stripe signature verification (no stripe-node needed)
  const parts = Object.fromEntries(sig.split(",").map(p => p.split("="))) as Record<string, string>;
  const payload = `${parts["t"]}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const expected = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))
  ).map(b => b.toString(16).padStart(2, "0")).join("");

  if (expected !== parts["v1"]) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const sub = event.data.object;
    const appId = (sub["metadata"] as Record<string, string>)?.["app_id"];
    if (appId) {
      const { PLAN_LIMITS } = await import("../lib/plan-limits");
      const priceId = (sub["items"] as { data: Array<{ price: { id: string } }> })?.data?.[0]?.price?.id;
      // Map price ID back to plan name
      const plan = priceId === c.env.STRIPE_PRICE_PRO ? "pro"
        : priceId === c.env.STRIPE_PRICE_STARTER ? "starter"
          : priceId === c.env.STRIPE_PRICE_ENTERPRISE ? "enterprise"
            : "free";

      await c.env.DB.prepare(
        `UPDATE application SET plan = ?, stripe_subscription_id = ?, plan_expires_at = ?, updatedAt = ? WHERE id = ?`
      ).bind(plan, sub["id"] as string, (sub["current_period_end"] as number) * 1000, Date.now(), appId).run();

      await syncPlanFeatures(c.env.DB, appId, plan as "free" | "starter" | "pro" | "enterprise");

      // Queue plan.updated for KV cache invalidation
      c.env.APP_EVENTS.send({ type: "plan.updated", appId, plan: plan as "free" | "starter" | "pro" | "enterprise" }).catch(() => { });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const appId = (sub["metadata"] as Record<string, string>)?.["app_id"];
    if (appId) {
      await c.env.DB.prepare(
        `UPDATE application SET plan = 'free', stripe_subscription_id = NULL, plan_expires_at = NULL, updatedAt = ? WHERE id = ?`
      ).bind(Date.now(), appId).run();
      await syncPlanFeatures(c.env.DB, appId, "free");
      c.env.APP_EVENTS.send({ type: "plan.updated", appId, plan: "free" }).catch(() => { });
    }
  }

  return Response.json({ received: true });
});

// ── OAUTH PROVIDERS ────────────────────────────────────────────────────────────

const SUPPORTED_PROVIDERS = ["google", "discord", "github", "microsoft", "apple", "facebook"] as const;
type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

/** GET /:id/oauth-providers — returns current per-app provider config */
appsRouter.get("/:id/oauth-providers", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  // Return all supported providers with their enabled state
  const rows = await c.env.DB
    .prepare("SELECT provider, enabled FROM app_oauth_provider WHERE app_id = ?")
    .bind(id)
    .all<{ provider: string; enabled: number }>()
    .then(r => r.results)
    .catch(() => [] as { provider: string; enabled: number }[]);

  const enabledSet = new Set(rows.filter(r => r.enabled).map(r => r.provider));
  // If no rows exist, only the providers our platform has actually configured
  // credentials for default to enabled. Apple/Facebook default OFF.
  const platformConfigured = new Set(["google", "github", "discord", "microsoft"]);
  const hasConfig = rows.length > 0;

  const providers = SUPPORTED_PROVIDERS.map(id => ({
    id,
    enabled: hasConfig ? enabledSet.has(id) : platformConfigured.has(id),
  }));

  return Response.json({ providers });
});

/** PUT /:id/oauth-providers — set which providers are enabled */
appsRouter.put("/:id/oauth-providers", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = c.req.param("id");
  const app = await getApplicationById(c.env.DB, id);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await c.req.json<{ providers: { id: string; enabled: boolean }[] }>();
  if (!Array.isArray(body.providers)) {
    return Response.json({ error: "providers array required" }, { status: 400 });
  }

  const now = Date.now();
  const { generateId } = await import("better-auth");

  // Upsert each provider row
  const stmts = body.providers
    .filter(p => (SUPPORTED_PROVIDERS as ReadonlyArray<string>).includes(p.id))
    .map(p =>
      c.env.DB.prepare(
        `INSERT INTO app_oauth_provider (id, app_id, provider, enabled, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (app_id, provider)
         DO UPDATE SET enabled = excluded.enabled, updatedAt = excluded.updatedAt`
      ).bind(`aop_${generateId(10)}`, id, p.id, p.enabled ? 1 : 0, now)
    );

  if (stmts.length) {
    await c.env.DB.batch(stmts).catch(e => {
      console.error("[apps] oauth-providers batch failed", e);
    });
  }

  // Invalidate appearance KV cache so SDK picks up new provider list
  invalidateAppKv(c.env.KV, app.publishable_key, id);

  return Response.json({ ok: true });
});

export { appsRouter };

