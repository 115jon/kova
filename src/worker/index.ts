// ============================================================================
// Kova Auth — Cloudflare Worker Entry
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
//   /.well-known/*              → OIDC discovery alias → /api/auth/.well-known/*
//   {slug}.auth.115jon.site/*   → Hosted auth subdomain (per-app isolated sign-in)
//   Dashboard documents/assets   → TanStack Start server entry
//
// Cloudflare primitives:
//   D1  (DB)          — primary database
//   KV  (KV)          — CORS origin cache + appearance cache + plan cache
//   Queue (APP_EVENTS) — async fan-out: deletion cleanup, plan sync, SMTP
//   DO  (APP_COUNTER) — per-app atomic stat counters (total_users, logins_24h)
// ============================================================================

import { Hono } from "hono";
import startHandler from "@tanstack/react-start/server-entry";
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

// ASSETS remains available to hosted-auth route types and the generated asset
// binding. Dashboard requests are delegated to TanStack Start below.
const app = new Hono<{ Bindings: Env & { ASSETS: Fetcher } }>();

function normalizeHost(host: string) {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isDashboardHost(host: string, baseHost: string) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;

  return normalizedHost === baseHost || ["localhost", "127.0.0.1", "::1"].includes(normalizedHost);
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
  // Guard: AUTH_URL must be set. If missing from the root .dev.vars, fall
  // through to normal routing rather than crashing the worker.
  // Fix: ensure .dev.vars exists and contains AUTH_URL=https://auth.lvh.me
  if (!c.env.AUTH_URL) {
    console.error("[kova-auth] AUTH_URL is not set. Check that .dev.vars is in the repository root.");
    return next();
  }

  let baseHost: string;
  try {
    baseHost = new URL(c.env.AUTH_URL).hostname; // e.g. "auth.115jon.site" or "auth.lvh.me"
  } catch {
    console.error(`[kova-auth] AUTH_URL is not a valid URL: "${c.env.AUTH_URL}"`);
    return next();
  }

  const host = c.req.header("Host") ?? "";

  // Root domain requests — fall through to normal routing
  if (!host || isDashboardHost(host, baseHost)) return next();

  // Subdomain or custom domain — resolve the owning application
  const ctx = await resolveAppByHost(c.req.raw, c.env.DB, c.env.KV, baseHost);
  if (!ctx) {
    // Unknown slug/domain — return a branded, minimal 404 HTML page
    return c.html(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>kova-auth — Not Found</title>
      <style>body{font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100svh;margin:0;background:#0a0a0a;color:#a0a0a0;}</style></head>
      <body><div style="text-align:center"><p style="font-size:2rem;color:#f5f5f5;margin:0">404</p>
      <p style="margin:12px 0 0">Application not found.</p>
      <p style="margin:4px 0 0;font-size:0.8rem">Check the subdomain or contact the app owner.</p>
      <p style="margin:18px 0 0;font-size:0.72rem;color:#606060">Secured by <strong style="color:#a0a0a0">kova-auth</strong></p>
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

app.all("/.well-known/*", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = `/api/auth${url.pathname}`;
  return authRouter.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
});

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
  return Response.redirect(`${c.env.CDN_URL}/kova-auth/${suffix}`, 301);
});

app.notFound((c) => {
  return c.text("Not found", 404);
});

type WorkerFetch = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

function authBaseHost(authUrl: string | undefined) {
  if (!authUrl) return "";
  try {
    return new URL(authUrl).hostname;
  } catch {
    return "";
  }
}

export function shouldUseHono(request: Request, authUrl?: string) {
  const url = new URL(request.url);
  if (
    url.pathname === "/health"
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/.well-known/")
  ) {
    return true;
  }
  return !isDashboardHost(url.host, authBaseHost(authUrl));
}

function isDashboardAsset(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const { pathname } = new URL(request.url);
  return pathname.startsWith("/_build/")
    || pathname.startsWith("/assets/")
    || pathname === "/favicon.svg"
    || /\.[a-z0-9]+$/i.test(pathname);
}

export function createWorker(
  startFetch: WorkerFetch,
  apiFetch: WorkerFetch = (request, env, ctx) => app.fetch(request, env, ctx),
  assetFetch: WorkerFetch = (request, env) => env.ASSETS.fetch(request),
) {
  return {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
      if (shouldUseHono(request, env.AUTH_URL)) {
        return apiFetch(request, env, ctx);
      }

      if (isDashboardAsset(request)) {
        return assetFetch(request, env, ctx);
      }

      return startFetch(request, env, ctx);
    },
    queue: handleQueueBatch,
  };
}

const worker = createWorker((request) => startHandler.fetch(request));

export default worker;

// ── Queue consumer export ─────────────────────────────────────────────────────
//
// Cloudflare Workers queue consumers are exported as a `queue` handler on the
// default export object, alongside the composed HTTP fetch handler.
