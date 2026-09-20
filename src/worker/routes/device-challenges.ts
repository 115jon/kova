import { Hono } from "hono";
import { logAudit } from "../audit";
import { createAuth } from "../auth";
import {
  approveDeviceChallenge,
  claimDeviceChallenge,
  createDeviceChallenge,
  denyDeviceChallenge,
  getDeviceChallenge,
  isDeviceChallengeId,
  toPublicView,
} from "../lib/device-challenge";
import { hasAdminRole, isAllowlistedAdminEmail } from "../lib/roles";

const deviceChallengesRouter = new Hono<{ Bindings: Env }>();

function dashboardOrigin(env: Env): string {
  try {
    return new URL(env.DASHBOARD_URL || env.AUTH_URL).origin;
  } catch {
    return "https://auth.115jon.site";
  }
}

function approveUrl(env: Env, id: string): string {
  return `${dashboardOrigin(env)}/approve/${id}`;
}

function twoFactorEnabled(user: {
  twoFactorEnabled?: boolean | number | null;
}): boolean {
  return Number(user.twoFactorEnabled) === 1 || user.twoFactorEnabled === true;
}

async function requireApprover(c: { env: Env; req: { raw: Request } }) {
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return { error: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const user = session.user as {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    twoFactorEnabled?: boolean | number | null;
  };

  if (!hasAdminRole(user.role)) {
    return {
      error: Response.json(
        { error: "admin_required", message: "Only a platform admin can approve a machine." },
        { status: 403 },
      ),
    };
  }

  if (!twoFactorEnabled(user)) {
    const row = await c.env.DB
      .prepare('SELECT twoFactorEnabled FROM "user" WHERE id = ? LIMIT 1')
      .bind(user.id)
      .first<{ twoFactorEnabled: number | null }>()
      .catch(() => null);
    if (Number(row?.twoFactorEnabled) !== 1) {
      return {
        error: Response.json(
          { error: "two_factor_required", message: "Turn on authenticator 2FA before approving a machine." },
          { status: 403 },
        ),
      };
    }
  }

  if (!isAllowlistedAdminEmail(user.email, c.env.DASHBOARD_ADMIN_EMAIL)) {
    return {
      error: Response.json(
        { error: "admin_email_required", message: "This account is not on the machine-approver list." },
        { status: 403 },
      ),
    };
  }

  return { user };
}

deviceChallengesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    hostname?: unknown;
    platform?: unknown;
    label?: unknown;
  };

  const created = await createDeviceChallenge(c.env.KV, {
    hostname: typeof body.hostname === "string" ? body.hostname : null,
    platform: typeof body.platform === "string" ? body.platform : null,
    label: typeof body.label === "string" ? body.label : null,
  });

  return c.json({
    ...toPublicView(created),
    approveUrl: approveUrl(c.env, created.id),
    pollUrl: `/api/device-challenges/${created.id}`,
  }, 201);
});

deviceChallengesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const challenge = await getDeviceChallenge(c.env.KV, id);
  if (!challenge) return c.json({ error: "not_found" }, 404);
  return c.json(toPublicView(challenge));
});

deviceChallengesRouter.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceChallengeId(id)) return c.json({ error: "not_found" }, 404);

  const gate = await requireApprover(c);
  if ("error" in gate && gate.error) return gate.error;

  const approved = await approveDeviceChallenge(c.env.KV, id, gate.user.id);
  if (!approved) {
    const current = await getDeviceChallenge(c.env.KV, id);
    if (!current) return c.json({ error: "not_found" }, 404);
    return c.json({ error: "not_pending", status: current.status }, 409);
  }

  c.executionCtx.waitUntil(
    logAudit(c.env.DB, {
      userId: gate.user.id,
      actor: gate.user.id,
      actorName: gate.user.name,
      actorEmail: gate.user.email,
      action: "device.approved",
      targetType: "user",
      targetId: approved.id,
      targetLabel: approved.hostname ?? approved.label,
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("User-Agent"),
      metadata: {
        hostname: approved.hostname,
        platform: approved.platform,
      },
    }).catch(() => undefined),
  );

  return c.json(toPublicView(approved));
});

deviceChallengesRouter.post("/:id/deny", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceChallengeId(id)) return c.json({ error: "not_found" }, 404);

  const gate = await requireApprover(c);
  if ("error" in gate && gate.error) return gate.error;

  const denied = await denyDeviceChallenge(c.env.KV, id, gate.user.id);
  if (!denied) {
    const current = await getDeviceChallenge(c.env.KV, id);
    if (!current) return c.json({ error: "not_found" }, 404);
    return c.json({ error: "not_pending", status: current.status }, 409);
  }

  return c.json(toPublicView(denied));
});

deviceChallengesRouter.post("/:id/claim", async (c) => {
  const id = c.req.param("id");
  const token = await claimDeviceChallenge(c.env.KV, id);
  if (!token) {
    const current = await getDeviceChallenge(c.env.KV, id);
    if (!current) return c.json({ error: "not_found" }, 404);
    if (current.status === "pending") return c.json({ error: "not_approved", status: "pending" }, 409);
    return c.json({ error: "already_claimed", status: current.status }, 409);
  }
  return c.json({ approvalToken: token, id });
});

export { deviceChallengesRouter };
