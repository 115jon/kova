import { Hono } from "hono";
import {
  createApplication,
  deleteApplication,
  getApplicationById,
  listApplications,
  rotateSecretKey,
  updateApplication,
} from "../applications";
import { createAuth } from "../auth";
import { hasAdminRole } from "../lib/roles";

const appsRouter = new Hono<{ Bindings: Env }>();

// ── Applications API ──────────────────────────────────────────────────────────
//
// All routes require admin role.
//
// GET    /api/admin/apps                 → list all apps
// POST   /api/admin/apps                 → create app (returns rawSecretKey ONCE)
// GET    /api/admin/apps/:id             → get single app
// PATCH  /api/admin/apps/:id             → update name/origins/redirectUris
// DELETE /api/admin/apps/:id             → delete
// POST   /api/admin/apps/:id/rotate-secret → rotate secret key

async function requireAdmin(c: { req: { raw: Request }; env: Env }) {
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !hasAdminRole((session.user as { role?: string }).role)) {
    return null;
  }
  return session;
}

appsRouter.get("/", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const apps = await listApplications(c.env.DB);
  return Response.json({ apps });
});

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

appsRouter.get("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const app = await getApplicationById(c.env.DB, c.req.param("id"));
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ app });
});

appsRouter.patch("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = (await c.req.raw.json()) as {
    name?: string;
    allowed_origins?: string[];
    redirect_uris?: string[];
  };
  const app = await updateApplication(c.env.DB, c.req.param("id"), body);
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ app });
});

appsRouter.delete("/:id", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  await deleteApplication(c.env.DB, c.req.param("id"));
  return Response.json({ ok: true });
});

appsRouter.post("/:id/rotate-secret", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const rawSecretKey = await rotateSecretKey(c.env.DB, c.req.param("id"), c.env.BETTER_AUTH_SECRET);
  return Response.json({ rawSecretKey });
});

export { appsRouter };

