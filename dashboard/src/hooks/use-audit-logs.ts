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
 *
 * The component calls fetchNextPage() when the user clicks "Load more".
 * The flat list is reconstructed by flattening pages[*].logs.
 */

import { GC_5M, STALE_30S } from "@/lib/query-client";
import { auditKeys, type AuditLogFilters } from "@/lib/query-keys";
import { useInfiniteQuery } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  userId: string;
  orgId: string | null;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  actorImage?: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface AuditLogPage {
  logs: AuditLogRow[];
  nextCursor: string | null;
}

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchAuditLogs(
  filters: AuditLogFilters,
  cursor: string | null,
): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.action) params.set("action", filters.action);
  if (filters.orgId) params.set("orgId", filters.orgId);
  if (cursor) params.set("before", cursor);
  params.set("limit", "50");

  const res = await fetch(`/api/audit/logs?${params}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Failed (${res.status})`);
  }
  return res.json() as Promise<AuditLogPage>;
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useAuditLogs(filters: AuditLogFilters) {
  return useInfiniteQuery<AuditLogPage, Error>({
    queryKey: auditKeys.list(filters),
    queryFn: ({ pageParam }) =>
      fetchAuditLogs(filters, (pageParam as string | null) ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: STALE_30S,
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
