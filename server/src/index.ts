﻿// ============================================================================
// Ralph Auth — Cloudflare Worker Entry
//
// Routes:
//   /api/auth/*                 → Better Auth (per-app pk enforcement)
//   /api/user/*                 → User self-service (avatar, fields, password)
//   /api/org/*                  → Org management (logo upload/remove)
//   /api/admin/audit/*          → Audit logs
//   /api/admin/users/*          → User admin (detail, avatar, fields)
//   /api/admin/sessions/*       → Session management
//   /api/admin/orgs/*           → Org settings + domains
//   /api/admin/apps/*           → Application registry + per-app sub-routes
//   /api/pub/apps/*             → Public app metadata (appearance, plan)
//   /api/webhooks/*             → Webhook endpoints
//   /api/avatar/*               → Legacy avatar redirect
//   /health                     → Health check
//   {slug}.auth.115jon.site/*   → Hosted auth subdomain (per-app isolated sign-in)
//   Everything else             → Workers Assets (dashboard SPA / index.html)
//
// Cloudflare primitives:
//   D1  (DB)          — primary database
//   KV  (KV)          — CORS origin cache + appearance cache + plan cache
//   Queue (APP_EVENTS) — async fan-out: deletion cleanup, plan sync, SMTP
//   DO  (APP_COUNTER) — per-app atomic stat counters (total_users, logins_24h)
// ============================================================================

import { Hono } from "hono";
import { AppCounter } from "./do/app-counter";
import { resolveAppByHost } from "./lib/subdomain";
import { corsMiddleware } from "./middleware/cors";
import { handleQueueBatch } from "./queue-consumer";
import { adminRouter } from "./routes/admin";
import { appsRouter } from "./routes/apps";
import { appUsersRouter } from "./routes/apps/users";
import { authRouter } from "./routes/auth";
import { hostedAuthRouter } from "./routes/hosted-auth";
import { handleOAuthBounce } from "./routes/oauth-bounce";
import { orgRouter } from "./routes/org";
import { pubAppsRouter } from "./routes/pub/apps";
import { userRouter } from "./routes/user";
import { webhooksRouter } from "./routes/webhooks";

// ── Durable Object export — required for Workers runtime to instantiate it ──
export { AppCounter };

// Re-export hasAdminRole for any consumers that import from index
export { hasAdminRole } from "./lib/roles";

// ASSETS is injected by [assets] binding + run_worker_first = true in wrangler.toml.
// Every request hits this worker first; non-API paths are handed off to Workers
// Assets which serves the dashboard SPA (index.html for any unmatched path).
const app = new Hono<{ Bindings: Env & { ASSETS: Fetcher } }>();

const DASHBOARD_ROUTES = new Set([
  "/",
  "/api-keys",
  "/applications",
  "/audit-logs",
  "/auth-error",
  "/oauth-apps",
  "/organizations",
  "/sessions",
  "/settings",
  "/sign-in",
  "/users",
  "/webhooks",
]);

function hasDashboardPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function shouldServeDashboardAssetOrRoute(path: string) {
  if (path.startsWith("/assets/")) return true;
  if (path === "/favicon.svg" || path === "/_headers") return true;
  if (DASHBOARD_ROUTES.has(path)) return true;
  if (hasDashboardPrefix(path, "/accept-invitation")) return true;
  if (hasDashboardPrefix(path, "/applications")) return true;
  if (hasDashboardPrefix(path, "/organizations")) return true;
  if (hasDashboardPrefix(path, "/users")) return true;
  return false;
}

// ── Global middleware ────────────────────────────────────────────────────────
// Handles OPTIONS preflight and injects CORS + security headers on all responses.
app.use("*", corsMiddleware());

// ── Subdomain dispatch ───────────────────────────────────────────────────────
// Intercepts requests arriving on *.auth.115jon.site (or registered custom domains)
// BEFORE any other route handler. Resolves the slug → Application, then delegates
// the entire request to hostedAuthRouter.
//
// WHY before CORS: the hosted sign-in page is on a different origin from the
// dashboard. CORS on the subdomain is handled inside hostedAuthRouter itself.
//
// Session isolation: hostedAuthRouter creates a new createAuth() instance with
// baseURL = 'https://{slug}.auth.115jon.site'. Better Auth emits cookies without
// a Domain= attribute → browser scopes them to the exact subdomain hostname.
app.use("*", async (c, next) => {
  // Guard: AUTH_URL must be set. If missing (e.g. .dev.vars not co-located with
  // wrangler.toml), fall through to normal routing rather than crashing the worker.
  // Fix: ensure dashboard/.dev.vars exists and contains AUTH_URL=https://auth.lvh.me
  if (!c.env.AUTH_URL) {
    console.error("[ralph-auth] AUTH_URL is not set. Check that .dev.vars is in the dashboard/ directory.");
    return next();
  }

  let baseHost: string;
  try {
    baseHost = new URL(c.env.AUTH_URL).hostname; // e.g. "auth.115jon.site" or "auth.lvh.me"
  } catch {
    console.error(`[ralph-auth] AUTH_URL is not a valid URL: "${c.env.AUTH_URL}"`);
    return next();
  }

  const host = c.req.header("Host") ?? "";

  // Root domain requests — fall through to normal routing
  if (!host || host === baseHost) return next();

  // Subdomain or custom domain — resolve the owning application
  const ctx = await resolveAppByHost(c.req.raw, c.env.DB, c.env.KV, baseHost);
  if (!ctx) {
    // Unknown slug/domain — return a branded, minimal 404 HTML page
    return c.html(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>ralph-auth — Not Found</title>
      <style>body{font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100svh;margin:0;background:#0a0a0a;color:#a0a0a0;}</style></head>
      <body><div style="text-align:center"><p style="font-size:2rem;color:#f5f5f5;margin:0">404</p>
      <p style="margin:12px 0 0">Application not found.</p>
      <p style="margin:4px 0 0;font-size:0.8rem">Check the subdomain or contact the app owner.</p>
      <p style="margin:18px 0 0;font-size:0.72rem;color:#606060">Secured by <strong style="color:#a0a0a0">ralph-auth</strong></p>
      </div></body></html>`,
      404
    );
  }

  // Stash the resolved context on c.env — this is the SAME object reference
  // passed to hostedAuthRouter.fetch() below. Hono context variables (c.set/get)
  // are scoped to a single context instance and are NOT visible across the
  // router boundary created by .fetch(). Env mutation is the safe cross-router
  // transport mechanism in Cloudflare Workers.
  (c.env as unknown as Record<string, unknown>)["__hostedApp"] = ctx;
  return hostedAuthRouter.fetch(c.req.raw, c.env, c.executionCtx);
});

// ── Health check ─────────────────────────────────────────────────────────────
// Minimal response — no service name or timestamp to avoid info leakage.
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Route modules ─────────────────────────────────────────────────────────────
app.route("/api/auth", authRouter);
app.route("/api/user", userRouter);
app.route("/api/org", orgRouter);
app.route("/api/admin", adminRouter);
app.route("/api/admin/apps", appsRouter);
app.route("/api/admin/apps/:appId/users", appUsersRouter);
app.route("/api/pub/apps", pubAppsRouter);
app.route("/api/webhooks", webhooksRouter);

// ── Central OAuth bounce ──────────────────────────────────────────────────────
// After a social sign-in on the main auth domain, Better Auth redirects here.
// We read the new session, create an auth ticket, and redirect to the target
// app subdomain — so Google Console only ever needs ONE callback URL per provider.
app.get("/api/hosted/oauth-complete", handleOAuthBounce);

// ── Legacy avatar redirect ────────────────────────────────────────────────────
//
// GET /api/avatar/*   → permanent redirect to CDN URL.
// Old DB rows stored relative /api/avatar/... paths; new uploads use absolute URLs.
app.get("/api/avatar/*", (c) => {
  const suffix = c.req.path.replace(/^\/api\/avatar\//, "");
  return Response.redirect(`${c.env.CDN_URL}/ralph-auth/${suffix}`, 301);
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
//
// Only unmatched dashboard paths are delegated to Workers Assets. Workers Assets
// has SPA fallback enabled, so passing scanner paths such as /wp-json/* through
// would turn them into index.html 200s instead of real 404s.
// Requires [assets] binding = "ASSETS" + run_worker_first = true in wrangler.toml.
app.notFound((c) => {
  if (shouldServeDashboardAssetOrRoute(c.req.path)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return c.text("Not found", 404);
});

export default app;

// ── Queue consumer export ─────────────────────────────────────────────────────
//
// Cloudflare Workers queue consumers are exported as a `queue` handler on the
// default export object. We export it separately so the runtime routes queue
// messages to `handleQueueBatch` while HTTP requests go through the Hono app.
export const queue = handleQueueBatch;
