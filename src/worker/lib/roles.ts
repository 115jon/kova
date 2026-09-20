/**
 * Returns true if the comma-separated role string includes the "admin" role.
 * Handles null/undefined gracefully.
 */
export function hasAdminRole(roleString: string | null | undefined): boolean {
  if (!roleString) return false;
  return roleString.split(",").map((r) => r.trim()).includes("admin");
}

export function parseEmailAllowlist(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlistedAdminEmail(
  userEmail: string | null | undefined,
  allowlist: string | null | undefined,
): boolean {
  const allowed = parseEmailAllowlist(allowlist);
  if (allowed.length === 0) return true;
  return allowed.includes((userEmail ?? "").trim().toLowerCase());
}
