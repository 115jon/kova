/**
 * @file hooks/use-additional-fields.ts
 * @description React Query hooks for the additional-fields (user metadata) system.
 *
 * ── Overview ──────────────────────────────────────────────────────────────────
 *
 * The additionalFields plugin stores arbitrary, typed metadata per user in a
 * separate `user_additional_fields` table.  This hook module provides:
 *
 *  Queries:
 *   - useFieldSchema()              — field definitions (labels, types, options)
 *   - useMyFields()                 — current user's own field values
 *   - useUserFields(userId)         — any user's fields (admin, used in user detail)
 *
 *  Mutations:
 *   - useUpdateMyFields             — self-service PATCH /api/user/fields
 *   - useUpdateUserFields           — admin PATCH /api/admin/users/:id/fields
 *
 * ── Cache strategy ───────────────────────────────────────────────────────────
 *
 *  - Schema:      staleTime=5min    — definitions rarely change without a deploy
 *  - Self-fields: staleTime=30s     — same cadence as other user data
 *  - Per-user:    staleTime=30s     — admin view, same cadence
 *
 *  Both mutations return the full hydrated field map from the server and
 *  immediately update the query cache (setQueryData) before the server
 *  response is returned, giving the UI an instant feel.
 *
 * ── Types ─────────────────────────────────────────────────────────────────────
 *
 *  FieldDefPublic  — serialisable shape of a field definition (from the schema
 *                    endpoint; no RegExp, just patternLabel: string).
 *  FieldValue      — string | number | boolean | null
 *  FieldMap        — Record<fieldKey, FieldValue> (hydrated with defaults)
 *  FieldError      — { key: string; message: string }
 *
 * These mirror the server types in additional-fields.ts to avoid a shared
 * package at this stage of development.
 */

import { GC_5M, STALE_2M, STALE_30S } from "@/lib/query-client";
import { profileKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ── Mirrored types (kept in sync with server/src/additional-fields.ts) ────────

/** Primitive value stored per field. null means "unset / use default". */
export type FieldValue = string | number | boolean | null;

/** Complete map of fieldKey → FieldValue for one user (hydrated with defaults). */
export type FieldMap = Record<string, FieldValue>;

/** Per-field validation error returned by the server on 422. */
export interface FieldError {
  key: string;
  message: string;
}

/** Public shape of a field definition returned by /api/user/fields/schema. */
export interface FieldDefPublic {
  key: string;
  label: string;
  description: string;
  /** "string" | "enum" | "boolean" | "number" */
  type: "string" | "enum" | "boolean" | "number";
  /** true → user can self-edit; false → admin-only */
  selfEditable: boolean;
  /** Value shown when no stored row exists */
  defaultValue: FieldValue;
  /** Only present for type:"enum" */
  options?: readonly string[];
  /** Only present for type:"string" */
  maxLength?: number;
  /** Human-readable description of the pattern constraint, if any */
  patternLabel?: string;
  /** Only present for type:"number" */
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface FieldSchemaResponse {
  fields: FieldDefPublic[];
}

export interface FieldsResponse {
  fields: FieldMap;
  /** Present on HTTP 207 (partial success). */
  partialErrors?: FieldError[];
}

export interface UpdateFieldsResult {
  fields: FieldMap;
  partialErrors?: FieldError[];
}

// ── Error handling helper ─────────────────────────────────────────────────────

async function parseApiError(res: Response, fallback: string): Promise<never> {
  const body = await res
    .json()
    .catch(() => ({ error: res.statusText })) as {
      error?: string;
      fieldErrors?: FieldError[];
    };
  const msg = body.error ?? fallback;
  throw Object.assign(new Error(msg), {
    status: res.status,
    fieldErrors: body.fieldErrors ?? [],
  });
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchFieldSchema(): Promise<FieldDefPublic[]> {
  const res = await fetch("/api/user/fields/schema", { credentials: "include" });
  if (!res.ok) await parseApiError(res, "Failed to load field schema");
  const data = (await res.json()) as FieldSchemaResponse;
  return data.fields ?? [];
}

async function fetchMyFields(): Promise<FieldMap> {
  const res = await fetch("/api/user/fields", { credentials: "include" });
  if (!res.ok) await parseApiError(res, "Failed to load profile fields");
  const data = (await res.json()) as FieldsResponse;
  return data.fields ?? {};
}

async function fetchUserFields(userId: string): Promise<FieldMap> {
  const res = await fetch(`/api/admin/users/${userId}/fields`, {
    credentials: "include",
  });
  if (!res.ok) await parseApiError(res, "Failed to load user fields");
  const data = (await res.json()) as FieldsResponse;
  return data.fields ?? {};
}

// ── Query: field schema ────────────────────────────────────────────────────────
//
// Fetches once and caches for 5 minutes with a 10-minute GC window.
// The schema only changes on server deploys, so a long cache is appropriate.

export function useFieldSchema() {
  return useQuery<FieldDefPublic[], Error>({
    queryKey: profileKeys.schema(),
    queryFn: fetchFieldSchema,
    staleTime: STALE_2M,
    gcTime: GC_5M * 2, // 10 minutes — schema is extremely stable
  });
}

// ── Query: current user's own fields ──────────────────────────────────────────

export function useMyFields() {
  return useQuery<FieldMap, Error>({
    queryKey: profileKeys.self(),
    queryFn: fetchMyFields,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Query: any user's fields (admin view) ─────────────────────────────────────

export function useUserFields(userId: string | null | undefined) {
  return useQuery<FieldMap, Error>({
    queryKey: profileKeys.user(userId ?? ""),
    queryFn: () => fetchUserFields(userId!),
    enabled: !!userId,
    staleTime: STALE_30S,
    gcTime: GC_5M,
  });
}

// ── Mutation: update own fields ───────────────────────────────────────────────
//
// Optimistic update: immediately writes the patch into the cache.
// On error, rolls back to the snapshot taken before the mutation started.
// On settle, invalidates to ensure consistency with any server-side logic.

export function useUpdateMyFields() {
  const qc = useQueryClient();

  return useMutation<UpdateFieldsResult, Error, Partial<FieldMap>>({
    mutationFn: async (patch) => {
      const res = await fetch("/api/user/fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });

      // 207 = partial success — still parse and return
      if (!res.ok && res.status !== 207) {
        await parseApiError(res, "Failed to update profile fields");
      }

      return res.json() as Promise<UpdateFieldsResult>;
    },

    // Optimistic update before the request completes
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: profileKeys.self() });
      const snapshot = qc.getQueryData<FieldMap>(profileKeys.self());
      if (snapshot) {
        qc.setQueryData<FieldMap>(profileKeys.self(), {
          ...snapshot,
          ...patch,
        } as FieldMap);
      }
      return { snapshot };
    },

    // On success, write the authoritative server state into the cache
    onSuccess: (data) => {
      qc.setQueryData<FieldMap>(profileKeys.self(), data.fields);
    },

    // Roll back optimistic update on network / validation error
    onError: (_err, _vars, context) => {
      const ctx = context as { snapshot?: FieldMap } | undefined;
      if (ctx?.snapshot !== undefined) {
        qc.setQueryData<FieldMap>(profileKeys.self(), ctx.snapshot);
      }
    },

    // Always re-validate after settle to ensure authoritative data
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.self() });
    },
  });
}

// ── Mutation: admin update any user's fields ───────────────────────────────────
//
// Same optimistic pattern but targets a specific userId.
// Also invalidates the user detail query so the admin panel stays consistent.

export function useUpdateUserFields(userId: string | null | undefined) {
  const qc = useQueryClient();

  return useMutation<
    UpdateFieldsResult,
    Error,
    { userId: string; patch: Partial<FieldMap> }
  >({
    mutationFn: async ({ userId: uid, patch }) => {
      const res = await fetch(`/api/admin/users/${uid}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });

      if (!res.ok && res.status !== 207) {
        await parseApiError(res, "Failed to update user fields");
      }

      return res.json() as Promise<UpdateFieldsResult>;
    },

    onMutate: async ({ userId: uid, patch }) => {
      const key = profileKeys.user(uid);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<FieldMap>(key);
      if (snapshot) {
        qc.setQueryData<FieldMap>(key, { ...snapshot, ...patch } as FieldMap);
      }
      return { snapshot, uid };
    },

    onSuccess: (data, { userId: uid }) => {
      qc.setQueryData<FieldMap>(profileKeys.user(uid), data.fields);
    },

    onError: (_err, { userId: uid }, context) => {
      const ctx = context as { snapshot?: FieldMap } | undefined;
      if (ctx?.snapshot !== undefined) {
        qc.setQueryData<FieldMap>(profileKeys.user(uid), ctx.snapshot);
      }
    },

    onSettled: (_data, _err, vars) => {
      if (vars) {
        void qc.invalidateQueries({ queryKey: profileKeys.user(vars.userId) });
      } else if (userId) {
        void qc.invalidateQueries({ queryKey: profileKeys.user(userId) });
      }
    },
  });
}

// ── Convenience: single-field update helper ────────────────────────────────────
//
// Thin wrapper so components can call `updateField("timezone", "America/Chicago")`
// instead of building the patch object themselves.  Returns the underlying
// mutation object so callers can observe loading / error state.

export function useUpdateSingleField() {
  const mutation = useUpdateMyFields();
  const update = (key: string, value: FieldValue) =>
    mutation.mutateAsync({ [key]: value });
  return { ...mutation, updateField: update };
}

// ── Type guard ────────────────────────────────────────────────────────────────

/** Narrows an unknown error to one that carries per-field validation errors. */
export function isFieldValidationError(
  err: unknown,
): err is Error & { fieldErrors: FieldError[] } {
  return (
    err instanceof Error &&
    "fieldErrors" in err &&
    Array.isArray((err as { fieldErrors: unknown }).fieldErrors)
  );
}
