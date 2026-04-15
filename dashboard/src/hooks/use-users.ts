/**
 * @file hooks/use-users.ts
 * @description React Query hooks for the /users and /users/$userId resources.
 *
 * Queries:
 *  - useUsers(filters)   — paginated admin list of all platform users
 *  - useUserDetail(id)   — aggregate admin view of a single user
 *
 * Mutations:
 *  - useSetUserRole      — promote/demote user ↔ admin
 *  - useBanUser          — ban a user with an optional reason
 *  - useUnbanUser        — lift an existing ban
 *  - useDeleteUser       — permanently delete a user account
 *
 * Invalidation strategy:
 *  Every mutation invalidates userKeys.all so both the list and any cached
 *  detail pages are marked stale.  Detail refetches happen automatically on
 *  the next render that observes them.
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { userKeys, type UserListFilters } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
}

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
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

export interface AuditEntry {
  id: string;
  action: string;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: number;
  metadata: Record<string, unknown> | null;
}

export interface UserDetailResponse {
  user: UserDetail;
  accounts: LinkedAccount[];
  sessionCount: number;
  apiKeyCount: number;
  recentActivity: AuditEntry[];
}

const PAGE_SIZE = 20;

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function fetchUsers(filters: UserListFilters): Promise<UserListResponse> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(filters.page * PAGE_SIZE),
    ...(filters.search
      ? {
        searchField: "email",
        searchValue: filters.search,
        searchOperator: "contains",
      }
      : {}),
  });
  const res = await fetch(`/api/auth/admin/list-users?${params}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: res.statusText }))) as {
      message?: string;
    };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<UserListResponse>;
}

async function fetchUserDetail(userId: string): Promise<UserDetailResponse> {
  const res = await fetch(`/api/admin/users/${userId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<UserDetailResponse>;
}

// ── Admin action helper ────────────────────────────────────────────────────────

async function adminPost(endpoint: string, body: object): Promise<void> {
  const res = await fetch(`/api/auth/admin/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Action failed (${res.status})`);
  }
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useUsers(filters: UserListFilters) {
  return useQuery<UserListResponse, Error>({
    queryKey: userKeys.list(filters),
    queryFn: () => fetchUsers(filters),
    staleTime: STALE_30S,
    gcTime: GC_5M,
    // Keep the previous page's data visible while the next page loads
    placeholderData: (previousData) => previousData,
  });
}

export function useUserDetail(userId: string) {
  return useQuery<UserDetailResponse, Error>({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetchUserDetail(userId),
    enabled: !!userId,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation hooks ─────────────────────────────────────────────────────────────

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminPost("set-role", { userId, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, banReason }: { userId: string; banReason: string }) =>
      adminPost("ban-user", { userId, banReason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useUnbanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      adminPost("unban-user", { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      adminPost("remove-user", { userId }),
    onSuccess: (_, { userId }) => {
      // Remove the detail entry immediately — user no longer exists
      qc.removeQueries({ queryKey: userKeys.detail(userId) });
      // Also stale the list
      void qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
