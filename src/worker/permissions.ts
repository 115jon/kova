/**
 * Organization access control definitions.
 *
 * We extend the built-in org statements with a custom `project` resource
 * so admins can define granular permissions on custom objects.
 *
 * Import this `ac` into auth.ts + any server endpoint that needs
 * `auth.api.hasPermission()`. The client side gets the same resource
 * names via the `organizationClient({ ac })` option in auth-client.ts.
 *
 * ⚠ Import from "better-auth/plugins/access" (not "better-auth/plugins")
 *    to keep the bundle size small in the Worker isolate.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";

// ── Resource + action catalogue ───────────────────────────────────────────────
// Add any app-specific resources here (e.g. "billing", "deploy", "repo").

const statement = {
  ...defaultStatements,

  // Custom resource examples — extend as your app grows.
  project: ["create", "update", "delete", "view"] as const,
  billing: ["read", "manage"] as const,
  deploy: ["trigger", "rollback"] as const,
} as const;

// ── Access controller ─────────────────────────────────────────────────────────
export const ac = createAccessControl(statement);

// ── Built-in roles (extend defaults with our custom resources) ────────────────
// The `...adminAc.statements` / `...memberAc.statements` spreads bring in
// the default CRUD statements Better Auth ships for org / member / invitation.

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "update", "delete", "view"],
  billing: ["read", "manage"],
  deploy: ["trigger", "rollback"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "update", "view"],
  billing: ["read"],
  deploy: ["trigger"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  project: ["view"],
  billing: [],
  deploy: [],
});
