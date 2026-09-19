/**
 * Returns true if the comma-separated role string includes the "admin" role.
 * Handles null/undefined gracefully.
 */
export function hasAdminRole(roleString: string | null | undefined): boolean {
  if (!roleString) return false;
  return roleString.split(",").map((r) => r.trim()).includes("admin");
}
