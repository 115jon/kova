import { hashPassword } from "better-auth/crypto";
import { createAuth } from "./auth";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ── Auth routes — delegate entirely to Better Auth ────────
    if (url.pathname.startsWith("/api/auth")) {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
      return auth.handler(request);
    }

    // ── Set initial password (OAuth-only users adding a password) ─
    //
    // Better Auth's admin.setUserPassword doesn't create a credential
    // account entry — it only updates an existing one. For OAuth-only
    // users we need to INSERT a new account row ourselves using the
    // same hashPassword function that Better Auth uses for sign-in.
    //
    // POST /api/user/set-initial-password  { newPassword: string }
    if (url.pathname === "/api/user/set-initial-password" && request.method === "POST") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

      // 1. Require a valid session
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return Response.json({ error: "Not authenticated" }, { status: 401 });
      }

      // 2. Parse + validate password
      let newPassword: string | undefined;
      try {
        const body = await request.json() as { newPassword?: string };
        newPassword = body.newPassword;
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
      if (!newPassword || newPassword.length < 8) {
        return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }

      // 3. Reject if credential account already exists — use changePassword instead
      const existing = await env.DB
        .prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'")
        .bind(session.user.id)
        .first<{ id: string }>();
      if (existing) {
        return Response.json(
          { error: "You already have a password. Use 'Change Password' to update it." },
          { status: 409 }
        );
      }

      // 4. Hash with Better Auth's own algorithm so sign-in works out of the box
      const hashed = await hashPassword(newPassword);

      // 5. Create the credential account row
      const accountId = crypto.randomUUID();
      const now = Date.now();
      await env.DB
        .prepare(
          `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
           VALUES (?, ?, 'credential', ?, ?, ?, ?)`
        )
        .bind(accountId, session.user.email, session.user.id, hashed, now, now)
        .run();

      return Response.json({ success: true });
    }

    // ── Health check ──────────────────────────────────────────
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "ralph-auth-server",
        ts: Date.now(),
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
