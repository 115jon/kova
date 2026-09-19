/**
 * @file query-client.ts
 * @description Singleton QueryClient for @tanstack/react-query.
 *
 * Design decisions:
 * - staleTime: 30s  — admin data rarely changes at sub-second frequency;
 *   avoids thundering-herd refetches on tab focus while keeping data fresh.
 * - gcTime: 5m      — cache entries are evicted 5 minutes after last observer
 *   is removed, keeping memory footprint low in a single-page admin shell.
 * - retry(false)    — authentication errors (401/403) should surface
 *   immediately rather than retrying 3 times and creating confusing UX.
 * - refetchOnWindowFocus: true (default) — security-sensitive admin views
 *   should always re-validate when the tab gains focus.
 * - throwOnError: false on queries — pages handle error states inline.
 */

import { QueryClient } from "@tanstack/react-query";

/** Shared stale time (ms): 30 seconds. */
export const STALE_30S = 30_000;
/** Shared stale time (ms): 2 minutes — for slower-changing resources. */
export const STALE_2M = 120_000;
/** Shared GC time (ms): 5 minutes — evict unobserved cache entries. */
export const GC_5M = 300_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_30S,
      gcTime: GC_5M,
      retry: false,
      refetchOnWindowFocus: true,
      throwOnError: false,
    },
    mutations: {
      retry: false,
    },
  },
});
