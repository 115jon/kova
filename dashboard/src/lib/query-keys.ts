/**
 * @file query-keys.ts
 * @description Centralised query key factory for @tanstack/react-query.
 *
 * Convention:
 *   queryKeys.resource.all        → invalidate everything for that resource
 *   queryKeys.resource.lists()    → invalidate all list variants
 *   queryKeys.resource.list(args) → a specific list with given filters/page
 *   queryKeys.resource.details()  → invalidate all detail variants
 *   queryKeys.resource.detail(id) → a specific entity by ID
 *
 * This pattern (popularised by TkDodo) enables surgical invalidation after
 * mutations without over-fetching.  The `as const` assertions preserve tuple
 * types so React Query can discriminate entries correctly.
 */

// ── Users ──────────────────────────────────────────────────────────────────────

export interface UserListFilters {
  page: number;
  search: string;
}

export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (filters: UserListFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, "detail"] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
} as const;

// ── Sessions ───────────────────────────────────────────────────────────────────

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: () => [...sessionKeys.lists()] as const,
} as const;

// ── API Keys ───────────────────────────────────────────────────────────────────

export interface ApiKeyFilters {
  organizationId: string | null;
}

export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (filters: ApiKeyFilters) => [...apiKeyKeys.lists(), filters] as const,
} as const;

// ── Organizations ──────────────────────────────────────────────────────────────

export const orgKeys = {
  all: ["organizations"] as const,
  lists: () => [...orgKeys.all, "list"] as const,
  list: () => [...orgKeys.lists()] as const,
  details: () => [...orgKeys.all, "detail"] as const,
  detail: (id: string) => [...orgKeys.details(), id] as const,
  members: (orgId: string) => [...orgKeys.detail(orgId), "members"] as const,
  invitations: (orgId: string) =>
    [...orgKeys.detail(orgId), "invitations"] as const,
  teams: (orgId: string) => [...orgKeys.detail(orgId), "teams"] as const,
  roles: (orgId: string) => [...orgKeys.detail(orgId), "roles"] as const,
} as const;

// ── Audit Logs ─────────────────────────────────────────────────────────────────

export interface AuditLogFilters {
  userId: string;
  action: string;
  orgId: string;
  // cursor is NOT a filter — it drives pagination outside the query key
}

export const auditKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditKeys.all, "list"] as const,
  list: (filters: AuditLogFilters) => [...auditKeys.lists(), filters] as const,
} as const;

// ── Webhooks ───────────────────────────────────────────────────────────────────

export const webhookKeys = {
  all: ["webhooks"] as const,
  lists: () => [...webhookKeys.all, "list"] as const,
  list: () => [...webhookKeys.lists()] as const,
} as const;

// ── Overview / Stats ───────────────────────────────────────────────────────────

export const overviewKeys = {
  all: ["overview"] as const,
  stats: () => [...overviewKeys.all, "stats"] as const,
} as const;

// ── Additional Fields (user profile metadata) ──────────────────────────────────
//
// Two sub-trees:
//   profileKeys.schema()       — the field definitions (rarely changes)
//   profileKeys.self()         — current user's field values
//   profileKeys.user(id)       — any user's field values (admin view)

export const profileKeys = {
  all: ["profile-fields"] as const,
  schema: () => [...profileKeys.all, "schema"] as const,
  self: () => [...profileKeys.all, "self"] as const,
  users: () => [...profileKeys.all, "user"] as const,
  user: (userId: string) => [...profileKeys.users(), userId] as const,
} as const;

// ── Applications ───────────────────────────────────────────────────────────────

export const appKeys = {
  all: ["applications"] as const,
  lists: () => [...appKeys.all, "list"] as const,
  list: () => [...appKeys.lists()] as const,
  detail: (id: string) => [...appKeys.all, "detail", id] as const,
} as const;

// ── Re-export all keys in a single namespace for convenience ──────────────────

export const queryKeys = {
  users: userKeys,
  sessions: sessionKeys,
  apiKeys: apiKeyKeys,
  organizations: orgKeys,
  auditLogs: auditKeys,
  webhooks: webhookKeys,
  overview: overviewKeys,
  profile: profileKeys,
  apps: appKeys,
} as const;

