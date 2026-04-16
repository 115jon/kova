/**
 * @file hooks/use-applications.ts
 * @description React Query hooks for Application management.
 *
 * An "Application" is a registered SDK consumer — it has a publishable key
 * (safe for client code) and a secret key (shown once, stored as a hash).
 *
 * Queries:
 *  - useApplications()       — list all registered apps
 *
 * Mutations:
 *  - useCreateApplication    — create + returns rawSecretKey once
 *  - useUpdateApplication    — patch name / origins / redirect_uris
 *  - useDeleteApplication    — permanently remove
 *  - useRotateSecret         — rotate secret key (returns new raw sk once)
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { appKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  name: string;
  environment: "development" | "production";
  publishable_key: string;
  allowed_origins: string[];
  redirect_uris: string[];
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateApplicationResult {
  app: Application;
  rawSecretKey: string;
}

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function fetchApplications(): Promise<Application[]> {
  const res = await fetch("/api/admin/apps", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { apps: Application[] };
  return data.apps ?? [];
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useApplications() {
  return useQuery<Application[], Error>({
    queryKey: appKeys.list(),
    queryFn: fetchApplications,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation: create ──────────────────────────────────────────────────────────

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation<
    CreateApplicationResult,
    Error,
    { name: string; environment: "development" | "production"; allowed_origins: string[]; redirect_uris: string[] }
  >({
    mutationFn: async (input) => {
      const res = await fetch("/api/admin/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const data = await res.json() as CreateApplicationResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create application");
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: appKeys.all }),
  });
}

// ── Mutation: update ──────────────────────────────────────────────────────────

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation<
    Application,
    Error,
    { id: string; name?: string; allowed_origins?: string[]; redirect_uris?: string[] }
  >({
    mutationFn: async ({ id, ...patch }) => {
      const res = await fetch(`/api/admin/apps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { app?: Application; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      return data.app!;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: appKeys.all }),
  });
}

// ── Mutation: delete ──────────────────────────────────────────────────────────

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: appKeys.list() });
      const snap = qc.getQueryData<Application[]>(appKeys.list());
      if (snap) qc.setQueryData<Application[]>(appKeys.list(), snap.filter(a => a.id !== id));
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      const c = ctx as { snap?: Application[] } | undefined;
      if (c?.snap) qc.setQueryData(appKeys.list(), c.snap);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: appKeys.all }),
  });
}

// ── Mutation: rotate secret ───────────────────────────────────────────────────

export function useRotateSecret() {
  return useMutation<{ rawSecretKey: string }, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/rotate-secret`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { rawSecretKey?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate");
      return { rawSecretKey: data.rawSecretKey! };
    },
  });
}
