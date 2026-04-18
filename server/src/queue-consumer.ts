/**
 * queue-consumer.ts — APP_EVENTS queue message handler.
 *
 * Handles async side-effects that must not block synchronous HTTP responses:
 *
 *   app.deleted      — R2 asset cleanup + Stripe customer archival
 *   plan.updated     — KV cache invalidation + app_plan_feature sync
 *   email.smtp       — SMTP email dispatch (Pro+ per-app email routing)
 *
 * Wired into the Worker via the `queue` export in index.ts.
 * Each message type is idempotent — safe to retry on transient failures.
 */

import { syncPlanFeatures, type Plan } from "./lib/plan-limits";

// ── Message types ─────────────────────────────────────────────────────────────

interface AppDeletedMsg {
  type: "app.deleted";
  appId: string;
  publishableKey: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface PlanUpdatedMsg {
  type: "plan.updated";
  appId: string;
  plan: Plan;
}

interface EmailSmtpMsg {
  type: "email.smtp";
  to: string;
  subject: string;
  html: string;
  text?: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    secure: boolean;
  };
}

export type AppEventMessage = AppDeletedMsg | PlanUpdatedMsg | EmailSmtpMsg;

// ── Queue batch handler ───────────────────────────────────────────────────────

export async function handleQueueBatch(
  batch: MessageBatch<AppEventMessage>,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await handleMessage(msg.body, env);
      msg.ack();
    } catch (err) {
      // Let the runtime retry via msg.retry() — do NOT call msg.ack()
      console.error(`[queue] Failed to process ${msg.body.type}:`, err);
      msg.retry();
    }
  }
}

// ── Per-message handlers ──────────────────────────────────────────────────────

async function handleMessage(msg: AppEventMessage, env: Env): Promise<void> {
  switch (msg.type) {
    case "app.deleted":
      return handleAppDeleted(msg, env);
    case "plan.updated":
      return handlePlanUpdated(msg, env);
    case "email.smtp":
      return handleEmailSmtp(msg);
    default: {
      const _exhaustive: never = msg;
      console.warn("[queue] Unknown message type:", (_exhaustive as AppEventMessage).type);
    }
  }
}

// ── app.deleted ───────────────────────────────────────────────────────────────

async function handleAppDeleted(msg: AppDeletedMsg, env: Env): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // 1. R2 asset cleanup — remove branding files
  // Note: env.R2 is the CDN worker's bucket exposed via service bindings.
  // If it's not bound here, skip gracefully.
  if ((env as Env & { CDN_R2?: R2Bucket }).CDN_R2) {
    const r2 = (env as Env & { CDN_R2: R2Bucket }).CDN_R2;
    if (msg.logoUrl) tasks.push(r2.delete(`apps/${msg.appId}/logo.webp`).catch(() => { }));
    if (msg.faviconUrl) tasks.push(r2.delete(`apps/${msg.appId}/favicon.ico`).catch(() => { }));
  }

  // 2. KV cache invalidation
  tasks.push(env.KV.delete(`appearance:${msg.publishableKey}`).catch(() => { }));
  tasks.push(env.KV.delete(`plan:${msg.appId}`).catch(() => { }));

  // 3. Stripe: archive customer metadata (preserve billing history)
  // The actual subscription cancellation happens via Stripe webhook → plan.updated.
  if (msg.stripeCustomerId && env.STRIPE_SECRET_KEY) {
    tasks.push(
      fetch(`https://api.stripe.com/v1/customers/${msg.stripeCustomerId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `metadata[archived_reason]=app_deleted&metadata[app_id]=${msg.appId}`,
      }).catch(() => { }) // non-fatal — Stripe may already be gone
    );

    // Cancel active subscription
    if (msg.stripeSubscriptionId) {
      tasks.push(
        fetch(`https://api.stripe.com/v1/subscriptions/${msg.stripeSubscriptionId}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        }).catch(() => { })
      );
    }
  }

  await Promise.all(tasks);
}

// ── plan.updated ──────────────────────────────────────────────────────────────

async function handlePlanUpdated(msg: PlanUpdatedMsg, env: Env): Promise<void> {
  // 1. Invalidate KV plan + appearance caches
  await Promise.all([
    env.KV.delete(`plan:${msg.appId}`),
    // We don't have the PK here — appearance cache will expire naturally (5 min)
  ]);

  // 2. Sync feature flags to app_plan_feature table
  await syncPlanFeatures(env.DB, msg.appId, msg.plan);
}

// ── email.smtp ────────────────────────────────────────────────────────────────

async function handleEmailSmtp(msg: EmailSmtpMsg): Promise<void> {
  // Cloudflare Workers can't use nodemailer (it needs TCP sockets).
  // Instead we use the Cloudflare-compatible `smtp` package via fetch+proxy,
  // OR we fall back to a Mailchannels/Resend API call.
  //
  // For now: emit a console.log so the queue is wired and testable.
  // The actual SMTP transport implementation is Phase 5 of the plan.
  console.log(
    `[email.smtp] Would send to ${msg.to}: "${msg.subject}" via ${msg.smtp.host}:${msg.smtp.port}`
  );
  // TODO Phase 5: implement fetch-based SMTP transport
  // See: https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
}
