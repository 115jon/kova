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
import { corsMiddleware } from "./middleware/cors";
import { handleQueueBatch } from "./queue-consumer";
import { adminRouter } from "./routes/admin";
import { appsRouter } from "./routes/apps";
import { appUsersRouter } from "./routes/apps/users";
import { authRouter } from "./routes/auth";
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

// ── Global middleware ────────────────────────────────────────────────────────
// Handles OPTIONS preflight and injects CORS + security headers on all responses.
app.use("*", corsMiddleware());

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
// All unmatched paths (dashboard routes: /, /sign-in, /dashboard/*, etc.)
// are delegated to Workers Assets which serves index.html for SPA navigation.
// Requires [assets] binding = "ASSETS" + run_worker_first = true in wrangler.toml.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// ── Queue consumer export ─────────────────────────────────────────────────────
//
// Cloudflare Workers queue consumers are exported as a `queue` handler on the
// default export object. We export it separately so the runtime routes queue
// messages to `handleQueueBatch` while HTTP requests go through the Hono app.
export const queue = handleQueueBatch;
