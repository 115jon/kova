/**
 * @file hooks/use-sessions.ts
 * @description React Query hooks for the sessions admin resource.
 *
 * Queries:
 *  - useSessions() — enriched session list from /api/admin/sessions
 *
 * Mutations:
 *  - useRevokeSession     — revoke a single session by token
 *  - useRevokeAllOthers   — bulk revoke all sessions except current
 *
 * Optimistic update strategy:
 *  useRevokeSession uses an optimistic removal so the card disappears
 *  immediately without waiting for the server round-trip.  On error it
 *  rolls back by restoring the snapshot from onMutate context.
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { sessionKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export type EnrichedSession = {
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  userName: string;
  userEmail: string;
  userImage: string | null;
  isCurrent: boolean;
  deviceType: "Desktop" | "Mobile" | "Tablet" | "Unknown";
  browser: string;
  browserVersion: string | null;
  os: string;
  osVersion: string | null;
  deviceLabel: string;
  geoCity: string | null;
  geoCountry: string | null;
  geoLocation: string | null;
  geoFlag: string | null;
};

export interface SessionsResponse {
  sessions: EnrichedSession[];
  currentSessionId: string;
}

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/admin/sessions", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SessionsResponse>;
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useSessions() {
  return useQuery<SessionsResponse, Error>({
    queryKey: sessionKeys.list(),
    queryFn: fetchSessions,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation: revoke single session ───────────────────────────────────────────

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation<void, Error, { sessionId: string }>({
    mutationFn: async ({ sessionId }) => {
      const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Failed to revoke session");
      }
    },
    // Optimistic removal — update cache before server responds
    onMutate: async ({ sessionId }) => {
      await qc.cancelQueries({ queryKey: sessionKeys.list() });
      const snapshot = qc.getQueryData<SessionsResponse>(sessionKeys.list());
      if (snapshot) {
        qc.setQueryData<SessionsResponse>(sessionKeys.list(), {
          ...snapshot,
          sessions: snapshot.sessions.filter((s) => s.id !== sessionId),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      // Roll back on failure
      const ctx = context as { snapshot?: SessionsResponse } | undefined;
      if (ctx?.snapshot) {
        qc.setQueryData(sessionKeys.list(), ctx.snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

// ── Mutation: revoke all except current ───────────────────────────────────────

export function useRevokeAllOtherSessions() {
  const qc = useQueryClient();
  return useMutation<{ revokedCount: number }, Error, { exceptSessionId: string }>({
    mutationFn: async ({ exceptSessionId }) => {
      const res = await fetch("/api/admin/sessions/revoke-all-others", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ exceptSessionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Revoke all failed");
      }
      return res.json() as Promise<{ revokedCount: number }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}
