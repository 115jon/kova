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
