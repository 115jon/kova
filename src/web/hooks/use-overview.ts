/**
 * @file hooks/use-overview.ts
 * @description React Query hook for the dashboard overview / stats page.
 *
 * Fetches users and sessions in parallel and shapes the data into a single
 * Stats object.  staleTime is set to 60s because overview numbers don't need
 * to be perfectly real-time.
 */

import { GC_5M } from "@/lib/query-client";
import { overviewKeys } from "@/lib/query-keys";
import { useQuery } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OverviewStats {
  totalUsers: number;
  activeSessions: number;
  bannedUsers: number;
  recentUsers: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
    role: string;
    image?: string | null;
  }[];
}

const STALE_60S = 60_000;

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchOverviewStats(): Promise<OverviewStats> {
  const [usersRes, sessionsRes] = await Promise.all([
    fetch("/api/auth/admin/list-users?limit=5", { credentials: "include" }),
    fetch("/api/auth/list-sessions", { credentials: "include" }),
  ]);
  const usersData = (await usersRes.json()) as {
    users: OverviewStats["recentUsers"];
    total: number;
  };
  const sessData = (await sessionsRes.json()) as
    | { session: unknown[] }
    | unknown[];
  const sessions = Array.isArray(sessData)
    ? sessData
    : ((sessData as { sessions?: unknown[] }).sessions ?? []);
  const banned =
    usersData.users?.filter((u: any) => u.banned).length ?? 0;

  return {
    totalUsers: usersData.total ?? usersData.users?.length ?? 0,
    activeSessions: sessions.length,
    bannedUsers: banned,
    recentUsers: usersData.users ?? [],
  };
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useOverviewStats() {
  return useQuery<OverviewStats, Error>({
    queryKey: overviewKeys.stats(),
    queryFn: fetchOverviewStats,
    staleTime: STALE_60S,
    gcTime: GC_5M,
  });
}
