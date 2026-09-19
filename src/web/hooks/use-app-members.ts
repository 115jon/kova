/**
 * @file hooks/use-app-members.ts
 * @description React Query hooks for the per-application user management detail page.
 *
 * Queries:
 *  - useAppMemberDetail(appId, userId)   — rich aggregate detail (member, accounts, activity)
 *
 * Mutations:
 *  - useAppMemberAvatarUpload            — upload new avatar
 *  - useAppMemberAvatarRemove            — remove avatar
 *  - useAppMemberBan                     — ban member (global)
 *  - useAppMemberUnban                   — unban member
 *  - useAppMemberLock                    — soft-lock (set banned=1, banReason="__locked__")
 *  - useAppMemberUnlock                  — unlock
 *  - useAppMemberRemove                  — remove from app (not global delete)
 *  - useAppMemberImpersonate             — request impersonation token
 *  - useAppMemberRoleChange              — change app role
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { appMemberKeys, appKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppMemberDetail {
  membershipId: string;
  userId: string;
  role: string;
  joinedAt: number;
  name: string | null;
  email: string | null;
  image: string | null;
  banned: boolean;
  banReason: string | null;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  username: string | null;
}

export interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: number;
}

export interface ActivityEntry {
  id: string;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface AppMemberDetailResponse {
  member: AppMemberDetail;
  accounts: LinkedAccount[];
  activeSessionCount: number;
  recentActivity: ActivityEntry[];
  /** Map of "YYYY-MM-DD" → event count for the past 365 days */
  activityHist: Record<string, number>;
}

export interface ImpersonateResult {
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
}

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchAppMemberDetail(appId: string, userId: string): Promise<AppMemberDetailResponse> {
  const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/detail`, {
    credentials: "include",
  });
  const data = await res.json() as AppMemberDetailResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useAppMemberDetail(appId: string, userId: string) {
  return useQuery<AppMemberDetailResponse, Error>({
    queryKey: appMemberKeys.detail(appId, userId),
    queryFn: () => fetchAppMemberDetail(appId, userId),
    enabled: Boolean(appId && userId),
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Helper ─────────────────────────────────────────────────────────────────────

async function memberPost(appId: string, userId: string, action: string, body?: object): Promise<void> {
  const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/${action}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
}

// ── Avatar mutations ───────────────────────────────────────────────────────────

export function useAppMemberAvatarUpload() {
  const qc = useQueryClient();
  return useMutation<{ imageUrl: string }, Error, { appId: string; userId: string; file: File }>({
    mutationFn: async ({ appId, userId, file }) => {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/avatar`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json() as { imageUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      return { imageUrl: data.imageUrl! };
    },
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
    },
  });
}

export function useAppMemberAvatarRemove() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: async ({ appId, userId }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/avatar`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
    },
  });
}

// ── Status mutations ───────────────────────────────────────────────────────────

export function useAppMemberBan() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string; reason?: string }>({
    mutationFn: ({ appId, userId, reason }) => memberPost(appId, userId, "ban", { reason }),
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

export function useAppMemberUnban() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: ({ appId, userId }) => memberPost(appId, userId, "unban"),
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

export function useAppMemberLock() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string; reason?: string }>({
    mutationFn: ({ appId, userId, reason }) => memberPost(appId, userId, "lock", { reason }),
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

export function useAppMemberUnlock() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: ({ appId, userId }) => memberPost(appId, userId, "unlock"),
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

export function useAppMemberRoleChange() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string; role: string }>({
    mutationFn: ({ appId, userId, role }) => memberPost(appId, userId, "role", { role }),
    onSuccess: (_v, { appId, userId }) => {
      void qc.invalidateQueries({ queryKey: appMemberKeys.detail(appId, userId) });
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

// ── Remove from app ────────────────────────────────────────────────────────────

export function useAppMemberRemove() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: async ({ appId, userId }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => {
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] });
    },
  });
}

// ── Impersonate ────────────────────────────────────────────────────────────────

export function useAppMemberImpersonate() {
  return useMutation<ImpersonateResult, Error, { appId: string; userId: string }>({
    mutationFn: async ({ appId, userId }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/impersonate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as ImpersonateResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to impersonate");
      return data;
    },
  });
}
