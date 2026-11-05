/**
 * @file hooks/use-audit-logs.ts
 * @description React Query hooks for audit log fetching with cursor pagination.
 *
 * Pattern: cursor-paginated "infinite scroll / load more" backed by
 * useInfiniteQuery.  Each page is keyed by the `before` cursor returned from
 * the previous page.
 *
 * Queries:
 *  - useAuditLogs(filters)   — paginated audit log stream
 *  - useAuditFacets()        — apps, countries and actions to filter by
 *
 * exportAuditLogs(filters) walks every page for CSV export, up to a cap.
 * The flat list is reconstructed by flattening pages[*].logs.
 */

import { type AuditLogRow, EXPORT_ROW_CAP, normalizeMetadata } from "@/lib/audit";
import { GC_5M, STALE_2M, STALE_30S } from "@/lib/query-client";
import { auditKeys, type AuditLogFilters } from "@/lib/query-keys";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

export type { AuditLogRow } from "@/lib/audit";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuditLogPage {
  logs: AuditLogRow[];
  nextCursor: string | null;
}

export interface AuditFacets {
  apps: { id: string; name: string }[];
  countries: string[];
  actions: string[];
}

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function readError(res: Response): Promise<Error> {
  const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
  return new Error(err.error ?? `Failed (${res.status})`);
}

export function auditLogParams(filters: AuditLogFilters, cursor: string | null, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.orgId) params.set("orgId", filters.orgId);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.q) params.set("q", filters.q);
  if (filters.appId) params.set("appId", filters.appId);
  if (filters.action) params.set("action", filters.action);
  if (filters.country) params.set("country", filters.country);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.from !== undefined) params.set("from", String(filters.from));
  if (filters.to !== undefined) params.set("to", String(filters.to));
  if (cursor) params.set("before", cursor);
  params.set("limit", String(limit));
  return params;
}

export async function fetchAuditLogs(
  filters: AuditLogFilters,
  cursor: string | null,
  limit = 50,
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const res = await fetch(`/api/admin/audit/logs?${auditLogParams(filters, cursor, limit)}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw await readError(res);
  const page = (await res.json()) as AuditLogPage;
  return {
    logs: (page.logs ?? []).map(row => ({ ...row, metadata: normalizeMetadata(row.metadata) })),
    nextCursor: page.nextCursor ?? null,
  };
}

/**
 * Every row matching `filters`, newest first, stopping at `cap`.
 * `capped` is true when more rows exist past the cap.
 */
export async function exportAuditLogs(
  filters: AuditLogFilters,
  { cap = EXPORT_ROW_CAP, signal, onProgress }: { cap?: number; signal?: AbortSignal; onProgress?: (count: number) => void } = {},
): Promise<{ rows: AuditLogRow[]; capped: boolean }> {
  const rows: AuditLogRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchAuditLogs(filters, cursor, 100, signal);
    rows.push(...page.logs);
    onProgress?.(Math.min(rows.length, cap));
    if (rows.length >= cap) {
      return { rows: rows.slice(0, cap), capped: rows.length > cap || page.nextCursor !== null };
    }
    if (!page.nextCursor || page.logs.length === 0) return { rows, capped: false };
    cursor = page.nextCursor;
  }
}

const EMPTY_FACETS: AuditFacets = { apps: [], countries: [], actions: [] };

async function fetchAuditFacets(): Promise<AuditFacets> {
  const res = await fetch("/api/admin/audit/facets", { credentials: "include" });
  // Older workers have no facets route; filters still work without suggestions.
  if (res.status === 404) return EMPTY_FACETS;
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as Partial<AuditFacets>;
  return {
    apps: Array.isArray(body.apps) ? body.apps : [],
    countries: Array.isArray(body.countries) ? body.countries : [],
    actions: Array.isArray(body.actions) ? body.actions : [],
  };
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useAuditLogs(filters: AuditLogFilters) {
  return useInfiniteQuery<AuditLogPage, Error>({
    queryKey: auditKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      fetchAuditLogs(filters, (pageParam as string | null) ?? null, 50, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

export function useAuditFacets() {
  return useQuery<AuditFacets, Error>({
    queryKey: auditKeys.facets(),
    queryFn: fetchAuditFacets,
    staleTime: STALE_2M,
    gcTime: GC_5M,
  });
}

// ── Derived selector ───────────────────────────────────────────────────────────

/**
 * Flatten all pages into a single log array.
 * Usage: const logs = flattenAuditPages(data);
 */
export function flattenAuditPages(
  data: ReturnType<typeof useAuditLogs>["data"],
): AuditLogRow[] {
  return data?.pages.flatMap((page) => page.logs) ?? [];
}
