/**
 * @file hooks/use-organizations.ts
 * @description React Query hooks for organization management.
 *
 * Queries:
 *  - useOrganizations()        — list all orgs the current user belongs to
 *  - useOrganizationDetail(id) — full org detail (members, invitations, teams, roles)
 *
 * Mutations:
 *  - useCreateOrganization     — create a new org
 *
 * Note: The orgId detail key is structured so that tabs within the org detail
 * page (members, invitations, teams, roles) can be invalidated independently
 * via orgKeys.members(orgId), orgKeys.invitations(orgId), etc.
 */

import { organization } from "@/lib/auth-client";
import { GC_5M, STALE_2M } from "@/lib/query-client";
import { orgKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OrgListItem {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  role?: string;
  // BA returns a Date object; string/number are also accepted for flexibility
  createdAt?: string | number | Date;
}

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function fetchOrganizations(): Promise<OrgListItem[]> {
  const res = await organization.list();
  if (res.error) throw new Error(res.error.message ?? "Failed to list organizations");
  return (res.data ?? []) as OrgListItem[];
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useOrganizations() {
  return useQuery<OrgListItem[], Error>({
    queryKey: orgKeys.list(),
    queryFn: fetchOrganizations,
    staleTime: STALE_2M,
    gcTime: GC_5M,
  });
}

// ── Mutation: create org ───────────────────────────────────────────────────────

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { name: string; slug: string }
  >({
    mutationFn: async ({ name, slug }) => {
      const res = await organization.create({ name, slug });
      if (res.error) throw new Error(res.error.message ?? "Failed to create organization");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgKeys.lists() });
    },
  });
}
