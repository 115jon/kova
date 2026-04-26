/**
 * @file hooks/use-applications.ts
 * @description React Query hooks for Application management — now fully multi-tenant aware.
 *
 * Applications are Clerk-style tenants: each has its own users, branding,
 * email config, billing, and lifecycle management.
 *
 * Queries:
 *  - useApplications()          — list all registered apps
 *  - useApplication(id)         — single app detail
 *  - useAppStats(id)            — live user/org/login counters
 *  - useAppMembers(id, filters) — paginated per-app user list
 *
 * Mutations:
 *  - useCreateApplication       — create + returns rawSecretKey once
 *  - useUpdateApplication       — patch any settable field (branding, email, smtp, origins)
 *  - useDeleteApplication       — hard delete with typed-name confirmation
 *  - useRotateSecret            — rotate secret key (returns new raw sk once)
 *  - useSuspendApp / useUnsuspendApp
 *  - useUploadLogo / useDeleteLogo
 *  - useUploadFavicon / useDeleteFavicon
 *  - useBillingCheckout / useBillingPortal
 *  - useBanMember / useUnbanMember / useChangeMemberRole / useRemoveMember
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
  // Branding
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  background_color: string;
  theme: "dark" | "light" | "auto";
  home_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  hide_branding: boolean;
  // Email
  from_name: string | null;
  from_email: string | null;
  support_email: string | null;
  // SMTP
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_secure: boolean;
  // Billing
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: "free" | "starter" | "pro" | "enterprise";
  plan_expires_at: number | null;
  // Lifecycle
  suspended_at: number | null;
  // Auth subdomain (migration 0018)
  auth_slug: string | null;
  custom_domain: string | null;
}

export interface AppStats {
  total_users: number;
  total_orgs: number;
  logins_24h: number;
  active_sessions: number;
}

export interface AppMember {
  membershipId: string;
  userId: string;
  role: string;
  joinedAt: number;
  name: string | null;
  email: string | null;
  image: string | null;
  banned: number;
  emailVerified: number;
  sessionCount: number;
}

export interface CreateApplicationResult {
  app: Application;
  rawSecretKey: string;
}

export type UpdateApplicationInput = Partial<Pick<Application,
  | "name" | "allowed_origins" | "redirect_uris"
  | "display_name" | "logo_url" | "favicon_url"
  | "primary_color" | "background_color" | "theme"
  | "home_url" | "terms_url" | "privacy_url"
  | "from_name" | "from_email" | "support_email"
  | "smtp_host" | "smtp_port" | "smtp_user" | "smtp_secure"
>>;

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function fetchApplications(): Promise<Application[]> {
  const res = await fetch("/api/admin/apps", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { apps: Application[] };
  return data.apps ?? [];
}

async function fetchApplication(id: string): Promise<Application> {
  const res = await fetch(`/api/admin/apps/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { app: Application };
  return data.app;
}

async function fetchAppStats(id: string): Promise<AppStats> {
  const res = await fetch(`/api/admin/apps/${id}/stats`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { stats: AppStats };
  return data.stats;
}

async function fetchAppMembers(
  id: string,
  page: number,
  search: string,
  role: string
): Promise<{ members: AppMember[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (search) params.set("search", search);
  if (role) params.set("role", role);
  const res = await fetch(`/api/admin/apps/${id}/users?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useApplications() {
  return useQuery<Application[], Error>({
    queryKey: appKeys.list(),
    queryFn: fetchApplications,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

export function useApplication(id: string) {
  return useQuery<Application, Error>({
    queryKey: appKeys.detail(id),
    queryFn: () => fetchApplication(id),
    staleTime: STALE_30S,
    gcTime: GC_5M,
    enabled: Boolean(id),
  });
}

export function useAppStats(id: string) {
  return useQuery<AppStats, Error>({
    queryKey: [...appKeys.detail(id), "stats"],
    queryFn: () => fetchAppStats(id),
    staleTime: 15_000, // refresh every 15 s
    gcTime: GC_5M,
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useAppMembers(id: string, page: number, search: string, role: string) {
  return useQuery({
    queryKey: [...appKeys.detail(id), "members", { page, search, role }],
    queryFn: () => fetchAppMembers(id, page, search, role),
    staleTime: STALE_30S,
    gcTime: GC_5M,
    enabled: Boolean(id),
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
    { id: string } & UpdateApplicationInput
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
    onSuccess: (app) => {
      qc.setQueryData(appKeys.detail(app.id), app);
      void qc.invalidateQueries({ queryKey: appKeys.all });
    },
  });
}

// ── Mutation: hard delete ─────────────────────────────────────────────────────

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; confirmedName: string }>({
    mutationFn: async ({ id, confirmedName }) => {
      const res = await fetch(`/api/admin/apps/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmedName }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    },
    onSuccess: (_v, { id }) => {
      qc.removeQueries({ queryKey: appKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: appKeys.all });
    },
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

// ── Mutation: suspend / unsuspend ─────────────────────────────────────────────

export function useSuspendApp() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/suspend`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

export function useUnsuspendApp() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/unsuspend`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

// ── Mutation: logo ────────────────────────────────────────────────────────────

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation<{ logoUrl: string }, Error, { id: string; file: File }>({
    mutationFn: async ({ id, file }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/apps/${id}/logo`, { method: "POST", credentials: "include", body: form });
      const data = await res.json() as { logoUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      return { logoUrl: data.logoUrl! };
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

export function useDeleteLogo() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/logo`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

// ── Mutation: favicon ─────────────────────────────────────────────────────────

export function useUploadFavicon() {
  const qc = useQueryClient();
  return useMutation<{ faviconUrl: string }, Error, { id: string; file: File }>({
    mutationFn: async ({ id, file }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/apps/${id}/favicon`, { method: "POST", credentials: "include", body: form });
      const data = await res.json() as { faviconUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      return { faviconUrl: data.faviconUrl! };
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

export function useDeleteFavicon() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/favicon`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { id }) => void qc.invalidateQueries({ queryKey: appKeys.detail(id) }),
  });
}

// ── Mutation: billing ─────────────────────────────────────────────────────────

export function useBillingCheckout() {
  return useMutation<{ url: string }, Error, { id: string; priceId: string }>({
    mutationFn: async ({ id, priceId }) => {
      const res = await fetch(`/api/admin/apps/${id}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");
      return { url: data.url! };
    },
  });
}

export function useBillingPortal() {
  return useMutation<{ url: string }, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/admin/apps/${id}/billing/portal`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to open portal");
      return { url: data.url! };
    },
  });
}

// ── Mutation: member management ───────────────────────────────────────────────

export function useBanMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string; reason?: string }>({
    mutationFn: async ({ appId, userId, reason }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] }),
  });
}

export function useUnbanMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: async ({ appId, userId }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/unban`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] }),
  });
}

export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string; role: string }>({
    mutationFn: async ({ appId, userId, role }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; userId: string }>({
    mutationFn: async ({ appId, userId }) => {
      const res = await fetch(`/api/admin/apps/${appId}/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "members"] }),
  });
}

// ── OAuth providers ───────────────────────────────────────────────────────────

export interface AppOAuthProvider {
  id: string;
  enabled: boolean;
}

export function useAppOAuthProviders(appId: string) {
  return useQuery<AppOAuthProvider[], Error>({
    queryKey: [...appKeys.detail(appId), "oauth-providers"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/apps/${appId}/oauth-providers`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { providers: AppOAuthProvider[] };
      return data.providers;
    },
    staleTime: STALE_30S,
    gcTime: GC_5M,
    enabled: Boolean(appId),
  });
}

export function useSetOAuthProviders() {
  const qc = useQueryClient();
  return useMutation<void, Error, { appId: string; providers: AppOAuthProvider[] }>({
    mutationFn: async ({ appId, providers }) => {
      const res = await fetch(`/api/admin/apps/${appId}/oauth-providers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ providers }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    },
    onSuccess: (_v, { appId }) => {
      void qc.invalidateQueries({ queryKey: [...appKeys.detail(appId), "oauth-providers"] });
    },
  });
}

