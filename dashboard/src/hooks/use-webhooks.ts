/**
 * @file hooks/use-webhooks.ts
 * @description React Query hooks for webhook endpoint management.
 *
 * Queries:
 *  - useWebhooks()            — list all webhook endpoints
 *
 * Mutations:
 *  - useCreateWebhook         — create a new endpoint; returns the raw secret
 *  - useDeleteWebhook         — permanently remove an endpoint
 *  - useToggleWebhook         — enable / disable an endpoint (optimistic)
 *
 * useToggleWebhook applies an optimistic update so the toggle feels instant,
 * then rolls back on error and refetches to ensure consistency.
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { webhookKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "user.signIn"
  | "user.signOut"
  | "user.signUp"
  | "user.passwordChanged"
  | "user.passwordSet"
  | "user.emailVerified"
  | "user.avatarUpdated"
  | "twoFactor.enabled"
  | "twoFactor.disabled"
  | "twoFactor.challengePassed"
  | "apiKey.created"
  | "apiKey.revoked"
  | "apiKey.allExpiredDeleted"
  | "session.revoked"
  | "session.revokeAll"
  | "session.expired"
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "member.roleChanged"
  | "admin.userBanned"
  | "admin.userUnbanned"
  | "admin.userDeleted"
  | "admin.roleChanged"
  | "admin.passwordReset";

export interface WebhookEndpoint {
  id: string;
  userId: string;
  orgId: string | null;
  url: string;
  events: string;
  eventList: AuditAction[] | ["*"];
  enabled: number;
  createdAt: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  failureCount: number;
}

export interface WebhookListResponse {
  endpoints: WebhookEndpoint[];
}

export interface CreateWebhookResult {
  endpoint: WebhookEndpoint;
  rawSecret: string;
}

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchWebhooks(): Promise<WebhookEndpoint[]> {
  const res = await fetch("/api/webhooks/endpoints", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as WebhookListResponse;
  return data.endpoints ?? [];
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useWebhooks() {
  return useQuery<WebhookEndpoint[], Error>({
    queryKey: webhookKeys.list(),
    queryFn: fetchWebhooks,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation: create endpoint ──────────────────────────────────────────────────

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation<
    CreateWebhookResult,
    Error,
    { url: string; events: string[] }
  >({
    mutationFn: async ({ url, events }) => {
      const res = await fetch("/api/webhooks/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url, events }),
      });
      const data = (await res.json()) as {
        endpoint?: WebhookEndpoint;
        rawSecret?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to create endpoint");
      return { endpoint: data.endpoint!, rawSecret: data.rawSecret! };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

// ── Mutation: delete endpoint ──────────────────────────────────────────────────

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/webhooks/endpoints/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    // Optimistic removal from the list
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: webhookKeys.list() });
      const snapshot = qc.getQueryData<WebhookEndpoint[]>(webhookKeys.list());
      if (snapshot) {
        qc.setQueryData<WebhookEndpoint[]>(
          webhookKeys.list(),
          snapshot.filter((ep) => ep.id !== id),
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { snapshot?: WebhookEndpoint[] } | undefined;
      if (ctx?.snapshot) {
        qc.setQueryData(webhookKeys.list(), ctx.snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

// ── Mutation: toggle enabled ───────────────────────────────────────────────────

export function useToggleWebhook() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; enabled: boolean }>({
    mutationFn: async ({ id, enabled }) => {
      const res = await fetch(`/api/webhooks/endpoints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    // Optimistic toggle
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: webhookKeys.list() });
      const snapshot = qc.getQueryData<WebhookEndpoint[]>(webhookKeys.list());
      if (snapshot) {
        qc.setQueryData<WebhookEndpoint[]>(
          webhookKeys.list(),
          snapshot.map((ep) =>
            ep.id === id ? { ...ep, enabled: enabled ? 1 : 0 } : ep,
          ),
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { snapshot?: WebhookEndpoint[] } | undefined;
      if (ctx?.snapshot) {
        qc.setQueryData(webhookKeys.list(), ctx.snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}
