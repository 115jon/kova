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
//   /api/admin/apps/*           → Application registry
//   /api/webhooks/*             → Webhook endpoints
//   /api/avatar/*               → Legacy avatar redirect
//   /health                     → Health check
// ============================================================================

import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors";
import { adminRouter } from "./routes/admin";
import { appsRouter } from "./routes/apps";
import { authRouter } from "./routes/auth";
import { orgRouter } from "./routes/org";
import { userRouter } from "./routes/user";
import { webhooksRouter } from "./routes/webhooks";

// Re-export hasAdminRole for any consumers that import from index
export { hasAdminRole } from "./lib/roles";

const app = new Hono<{ Bindings: Env }>();

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
app.route("/api/webhooks", webhooksRouter);

// ── Legacy avatar redirect ────────────────────────────────────────────────────
//
// GET /api/avatar/*   → permanent redirect to CDN URL.
// Old DB rows stored relative /api/avatar/... paths; new uploads use absolute URLs.
app.get("/api/avatar/*", (c) => {
  const suffix = c.req.path.replace(/^\/api\/avatar\//, "");
  return Response.redirect(`${c.env.CDN_URL}/ralph-auth/${suffix}`, 301);
});

export default app;
