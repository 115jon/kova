/**
 * @file hooks/use-overview.ts
 * @description React Query hook for the dashboard overview / stats page.
 *
 * Fetches recent users and the platform counts in parallel and shapes them
 * into a single Stats object.  staleTime is set to 60s because overview
 * numbers don't need to be perfectly real-time.
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
  // /api/admin/stats counts across the platform. Better Auth's list-sessions is
  // not an option: it lists only the caller's own sessions and answers 403
  // SESSION_NOT_FRESH once the dashboard session is older than freshAge.
  const [usersRes, statsRes] = await Promise.all([
    fetch("/api/auth/admin/list-users?limit=5", { credentials: "include" }),
    fetch("/api/admin/stats", { credentials: "include" }),
  ]);
  // A failed request must surface as an error, not as a quiet 0.
  if (!usersRes.ok || !statsRes.ok) {
    throw new Error(`Overview failed (${usersRes.ok ? statsRes.status : usersRes.status})`);
  }
  const usersData = (await usersRes.json()) as {
    users: OverviewStats["recentUsers"];
    total: number;
  };
  const stats = (await statsRes.json()) as { activeSessions: number; bannedUsers: number };

  return {
    totalUsers: usersData.total ?? usersData.users?.length ?? 0,
    activeSessions: stats.activeSessions,
    bannedUsers: stats.bannedUsers,
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
