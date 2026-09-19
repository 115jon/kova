export function shouldMintAppSessionToken(input: {
  publishableKey?: string;
  sessionToken: string | null;
  isPending: boolean;
}): boolean {
  return Boolean(input.publishableKey) && !input.sessionToken && !input.isPending;
}

export type AuthSessionPayload = {
  session?: {
    id?: string;
    token?: string | null;
    activeOrganizationId?: string | null;
  } | null;
  user?: {
    id: string;
    name?: string | null;
    email?: string;
  } | null;
} | null;

export function readAuthSessionPayload(data: unknown): AuthSessionPayload {
  if (!data || typeof data !== "object") return null;
  return data as AuthSessionPayload;
}
