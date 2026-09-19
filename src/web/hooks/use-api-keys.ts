/**
 * @file hooks/use-api-keys.ts
 * @description React Query hooks for API key management.
 *
 * Queries:
 *  - useApiKeys(filters)    — list keys scoped to org or personal
 *
 * Mutations:
 *  - useDeleteApiKey        — revoke a key by ID + configId
 *
 * Note: Key creation goes through the Better Auth SDK (apiKey.create) which
 * is already imperative.  After creation the component calls
 * queryClient.invalidateQueries(...) directly to re-fetch the list.
 */

import { apiKey } from "@/lib/auth-client";
import { GC_5M, STALE_30S } from "@/lib/query-client";
import { apiKeyKeys, type ApiKeyFilters } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ApiKeyItem {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  lastRequest: Date | string | null;
  requestCount: number;
  configId?: string;
}

// ── Fetcher ────────────────────────────────────────────────────────────────────

async function fetchApiKeys(filters: ApiKeyFilters): Promise<ApiKeyItem[]> {
  const res = await apiKey.list({
    query: {
      configId: filters.organizationId ? "organization" : "personal",
      sortBy: "createdAt",
      sortDirection: "desc",
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    },
  });
  if (res.error) throw new Error(res.error.message ?? "Failed to load API keys");
  return (res.data?.apiKeys ?? []) as ApiKeyItem[];
}

// ── Query hook ─────────────────────────────────────────────────────────────────

export function useApiKeys(filters: ApiKeyFilters) {
  return useQuery<ApiKeyItem[], Error>({
    queryKey: apiKeyKeys.list(filters),
    queryFn: () => fetchApiKeys(filters),
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation: revoke key ───────────────────────────────────────────────────────

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { id: string; configId: string; organizationId: string | null }
  >({
    mutationFn: async ({ id, configId }) => {
      // configId must be passed explicitly — BA throws 400 when multiple
      // configs exist and no default has been designated.
      // The Better Auth API key client uses `keyId` in its delete signature.
      // The `as any` cast is intentional — this is a known BA type quirk where
      // the generated type expects `keyId` but the runtime accepts `id` too.
      const res = await (apiKey.delete as any)({ id, configId });
      if ((res as any)?.error)
        throw new Error((res as any).error.message ?? "Failed to revoke key");
    },
    onSuccess: (_data, { organizationId }) => {
      void qc.invalidateQueries({
        queryKey: apiKeyKeys.list({ organizationId }),
      });
    },
  });
}
