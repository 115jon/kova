import { Hono } from "hono";
import type { AuditAction } from "../audit";
import { createAuth } from "../auth";
import { hasAdminRole } from "../lib/roles";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  sendTestPing,
  setWebhookEnabled,
} from "../webhook";

const webhooksRouter = new Hono<{ Bindings: Env }>();

// ── Webhook endpoints: list + create ─────────────────────────────────────────
//
// GET  /api/webhooks/endpoints
// POST /api/webhooks/endpoints
webhooksRouter.get("/endpoints", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const orgId = c.req.query("orgId") ?? undefined;
  const endpoints = await listWebhookEndpoints(env.DB, { orgId });
  return Response.json({ endpoints });
});

webhooksRouter.post("/endpoints", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { url?: string; events?: unknown; orgId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.url || typeof body.url !== "string") {
    return Response.json({ error: "'url' is required" }, { status: 400 });
  }
  try {
    const parsed = new URL(body.url);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      !parsed.hostname.startsWith("127.")
    ) {
      return Response.json({ error: "Webhook URL must use HTTPS" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  const events =
    Array.isArray(body.events) && body.events.length > 0
      ? (body.events as AuditAction[])
      : (["*"] as ["*"]);

  const { endpoint, rawSecret } = await createWebhookEndpoint(env.DB, {
    userId: session.user.id,
    orgId: body.orgId ?? null,
    url: body.url,
    events,
  });

  return Response.json({ endpoint, rawSecret }, { status: 201 });
});

// ── Webhook endpoint: delete ──────────────────────────────────────────────────
//
// DELETE /api/webhooks/endpoints/:id
webhooksRouter.delete("/endpoints/:id", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const endpointId = c.req.param("id");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const deleted = await deleteWebhookEndpoint(env.DB, endpointId);
  if (!deleted) {
    return Response.json({ error: "Endpoint not found" }, { status: 404 });
  }
  return Response.json({ success: true });
});

// ── Webhook endpoint: toggle enabled ─────────────────────────────────────────
//
// PATCH /api/webhooks/endpoints/:id   body: { enabled: boolean }
webhooksRouter.patch("/endpoints/:id", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const endpointId = c.req.param("id");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { enabled?: boolean };
  try {
    body = (await request.json()) as { enabled?: boolean };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return Response.json({ error: "'enabled' (boolean) is required" }, { status: 400 });
  }

  const updated = await setWebhookEnabled(env.DB, endpointId, body.enabled);
  if (!updated) {
    return Response.json({ error: "Endpoint not found" }, { status: 404 });
  }
  return Response.json({ success: true, enabled: body.enabled });
});

// ── Webhook endpoint: test ping ───────────────────────────────────────────────
//
// POST /api/webhooks/endpoints/:id/test
webhooksRouter.post("/endpoints/:id/test", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const endpointId = c.req.param("id");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const result = await sendTestPing(env.DB, endpointId);
  const statusCode = result.status === 404 ? 404 : 200;
  return Response.json(result, { status: statusCode });
});

export { webhooksRouter };

