/**
 * @file server/src/additional-fields.ts
 * @description Additional (extensible) metadata fields per user.
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 * Rather than locking the schema into the core `user` table (which Better Auth
 * owns), we keep a separate `user_additional_fields` table with rows like:
 *
 *   (userId, fieldKey, value)  where `value` is JSON-encoded.
 *
 * The FIELD_DEFINITIONS registry below is the single source of truth for:
 *   • Which keys are allowed                   (allowlist enforcement)
 *   • Human-readable labels / descriptions     (sent to clients)
 *   • Per-field validation rules               (type + enum/regex/range)
 *   • Whether users can self-edit the field    (some may be admin-only)
 *   • Default value when unset                 (shown in UI placeholders)
 *
 * Adding a new field never requires a DB migration — just append a new entry
 * to FIELD_DEFINITIONS and deploy.  Old rows for removed fields are ignored.
 *
 * ── Supported value types ────────────────────────────────────────────────────
 *   "string"  — free-text (optional maxLength)
 *   "enum"    — must match one of the `options` values
 *   "boolean" — true | false
 *   "number"  — integer or float (optional min / max)
 *
 * ── API surface (consumed by index.ts) ───────────────────────────────────────
 *   getAdditionalFields(db, userId)          → FieldMap
 *   setAdditionalFields(db, userId, patch)   → { saved: FieldMap; errors: FieldError[] }
 *   fieldDefinitions                         → public readonly registry
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** Primitive value types stored per field. */
export type FieldValue = string | number | boolean | null;

/** A flat record of fieldKey → value (null means "unset / use default"). */
export type FieldMap = Record<string, FieldValue>;

/** Error detail returned when a value fails validation. */
export interface FieldError {
  key: string;
  message: string;
}

/** Validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
}

/** Base definition shared by all field types. */
interface FieldDefBase {
  /** Machine-readable unique key (snake_case). */
  key: string;
  /** Human-readable label for UI display. */
  label: string;
  /** Longer description shown as placeholder / tooltip. */
  description: string;
  /**
   * Whether an unprivileged user may write this field themselves.
   * If false, only admins can set it via /api/admin/users/:id/fields.
   */
  selfEditable: boolean;
  /**
   * Default value to surface when no row exists.
   * null means "no default" — the field is optional / empty.
   */
  defaultValue: FieldValue;
}

interface StringFieldDef extends FieldDefBase {
  type: "string";
  /** Optional: maximum number of characters (inclusive). */
  maxLength?: number;
  /** Optional: regex pattern the value must match. */
  pattern?: RegExp;
  /** Optional: human-readable description of pattern for error messages. */
  patternLabel?: string;
}

interface EnumFieldDef extends FieldDefBase {
  type: "enum";
  /** The allowed string values exactly. */
  options: readonly string[];
}

interface BooleanFieldDef extends FieldDefBase {
  type: "boolean";
}

interface NumberFieldDef extends FieldDefBase {
  type: "number";
  min?: number;
  max?: number;
  integer?: boolean;
}

export type FieldDef =
  | StringFieldDef
  | EnumFieldDef
  | BooleanFieldDef
  | NumberFieldDef;

// ── Field registry ─────────────────────────────────────────────────────────────
//
// ADD NEW FIELDS HERE.  No DB migration required; values are stored as
// (userId, fieldKey, JSON-value) rows in `user_additional_fields`.
//
// Convention:
//   - Use snake_case keys that are stable identifiers (renaming = data loss).
//   - Keep selfEditable: true for everything users should control.
//   - Admin-only fields (e.g. appRole, internalNotes) use selfEditable: false.

export const FIELD_DEFINITIONS: readonly FieldDef[] = [
  // ── Localisation ────────────────────────────────────────────────────────────

  {
    key: "timezone",
    type: "string",
    label: "Timezone",
    description: "IANA timezone identifier, e.g. America/Chicago or Europe/London",
    selfEditable: true,
    defaultValue: null,
    // Rough guard: IANA zones are "Region/City" or "Region/Sub/City"
    pattern: /^[A-Za-z_]+(?:\/[A-Za-z_]+){1,2}$|^UTC$|^GMT([+-]\d+)?$/,
    patternLabel: "Valid IANA timezone (e.g. America/Chicago, UTC)",
    maxLength: 64,
  } satisfies StringFieldDef,

  {
    key: "locale",
    type: "enum",
    label: "Display Language",
    description: "Preferred UI language / locale",
    selfEditable: true,
    defaultValue: "en",
    options: [
      "en",     // English
      "en-GB",  // English (UK)
      "es",     // Spanish
      "fr",     // French
      "de",     // German
      "ja",     // Japanese
      "zh",     // Chinese (Simplified)
      "pt",     // Portuguese
      "ar",     // Arabic
      "ko",     // Korean
    ] as const,
  } satisfies EnumFieldDef,

  // ── Identity / Display ──────────────────────────────────────────────────────

  {
    key: "display_name",
    type: "string",
    label: "Display Name",
    description: "Preferred name shown in the application (overrides account name in some views)",
    selfEditable: true,
    defaultValue: null,
    maxLength: 64,
  } satisfies StringFieldDef,

  {
    key: "bio",
    type: "string",
    label: "Bio",
    description: "Short personal bio or description visible on your profile",
    selfEditable: true,
    defaultValue: null,
    maxLength: 280,
  } satisfies StringFieldDef,

  // ── Preferences ─────────────────────────────────────────────────────────────

  {
    key: "theme",
    type: "enum",
    label: "Theme",
    description: "Dashboard color theme preference",
    selfEditable: true,
    defaultValue: "system",
    options: ["light", "dark", "system"] as const,
  } satisfies EnumFieldDef,

  {
    key: "email_notifications",
    type: "boolean",
    label: "Email Notifications",
    description: "Receive email digests for account activity and security alerts",
    selfEditable: true,
    defaultValue: true,
  } satisfies BooleanFieldDef,

  // ── Application-level roles / metadata (admin-only) ─────────────────────────

  {
    key: "app_role",
    type: "enum",
    label: "Application Role",
    description: "Platform-level role for external application access control (admin-managed)",
    selfEditable: false,   // Only admins should set this
    defaultValue: "viewer",
    options: ["viewer", "editor", "manager", "developer", "owner"] as const,
  } satisfies EnumFieldDef,

  {
    key: "department",
    type: "string",
    label: "Department",
    description: "Organisational department or team (admin-managed)",
    selfEditable: false,
    defaultValue: null,
    maxLength: 128,
  } satisfies StringFieldDef,

  {
    key: "employee_id",
    type: "string",
    label: "Employee ID",
    description: "Internal employee or contractor identifier (admin-managed)",
    selfEditable: false,
    defaultValue: null,
    maxLength: 64,
    pattern: /^[A-Za-z0-9_-]+$/,
    patternLabel: "Alphanumeric, underscores and hyphens only",
  } satisfies StringFieldDef,
] as const;

// ── Derived lookup structures ──────────────────────────────────────────────────

/** Record<fieldKey, FieldDef> for O(1) lookups. */
export const FIELD_MAP: Readonly<Record<string, FieldDef>> = Object.fromEntries(
  FIELD_DEFINITIONS.map((f) => [f.key, f]),
);

/** Set of field keys that users are allowed to self-edit. */
export const SELF_EDITABLE_KEYS: ReadonlySet<string> = new Set(
  FIELD_DEFINITIONS.filter((f) => f.selfEditable).map((f) => f.key),
);

/** Public shape sent to clients — omits the internal `pattern` RegExp. */
export interface FieldDefPublic {
  key: string;
  label: string;
  description: string;
  type: "string" | "enum" | "boolean" | "number";
  selfEditable: boolean;
  defaultValue: FieldValue;
  options?: readonly string[];
  maxLength?: number;
  patternLabel?: string;
  min?: number;
  max?: number;
  integer?: boolean;
}

/** Strip non-serialisable fields (RegExp) before sending over the wire. */
export function toPublicDef(def: FieldDef): FieldDefPublic {
  const { key, label, description, type, selfEditable, defaultValue } = def;
  const base: FieldDefPublic = { key, label, description, type, selfEditable, defaultValue };
  if (def.type === "enum") base.options = def.options;
  if (def.type === "string") {
    if (def.maxLength !== undefined) base.maxLength = def.maxLength;
    if (def.patternLabel) base.patternLabel = def.patternLabel;
  }
  if (def.type === "number") {
    if (def.min !== undefined) base.min = def.min;
    if (def.max !== undefined) base.max = def.max;
    if (def.integer !== undefined) base.integer = def.integer;
  }
  return base;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates a raw value against a field definition.
 *
 * Returns `{ valid: true }` or `{ valid: false, message: "..." }`.
 */
export function validateFieldValue(
  def: FieldDef,
  rawValue: unknown,
): { valid: true } | { valid: false; message: string } {
  // null / undefined → field is being cleared; always valid (no required enforcement)
  if (rawValue === null || rawValue === undefined) {
    return { valid: true };
  }

  switch (def.type) {
    case "string": {
      if (typeof rawValue !== "string") return { valid: false, message: `${def.label} must be a string` };
      if (def.maxLength !== undefined && rawValue.length > def.maxLength) {
        return { valid: false, message: `${def.label} must be at most ${def.maxLength} characters` };
      }
      if (def.pattern && !def.pattern.test(rawValue)) {
        return {
          valid: false,
          message: `${def.label} format is invalid${def.patternLabel ? `: ${def.patternLabel}` : ""}`,
        };
      }
      return { valid: true };
    }

    case "enum": {
      if (typeof rawValue !== "string") return { valid: false, message: `${def.label} must be a string` };
      if (!(def.options as readonly string[]).includes(rawValue)) {
        return {
          valid: false,
          message: `${def.label} must be one of: ${def.options.join(", ")}`,
        };
      }
      return { valid: true };
    }

    case "boolean": {
      if (typeof rawValue !== "boolean") return { valid: false, message: `${def.label} must be true or false` };
      return { valid: true };
    }

    case "number": {
      if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        return { valid: false, message: `${def.label} must be a number` };
      }
      if (def.integer && !Number.isInteger(rawValue)) {
        return { valid: false, message: `${def.label} must be an integer` };
      }
      if (def.min !== undefined && rawValue < def.min) {
        return { valid: false, message: `${def.label} must be ≥ ${def.min}` };
      }
      if (def.max !== undefined && rawValue > def.max) {
        return { valid: false, message: `${def.label} must be ≤ ${def.max}` };
      }
      return { valid: true };
    }
  }
}

/**
 * Validates a patch object (multiple fields at once).
 * Unknown keys are rejected.
 * When `selfEditableOnly` is true, admin-only keys are also rejected.
 */
export function validatePatch(
  patch: Record<string, unknown>,
  selfEditableOnly = false,
): ValidationResult {
  const errors: FieldError[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const def = FIELD_MAP[key];
    if (!def) {
      errors.push({ key, message: `Unknown field "${key}"` });
      continue;
    }
    if (selfEditableOnly && !def.selfEditable) {
      errors.push({ key, message: `Field "${key}" can only be updated by an administrator` });
      continue;
    }
    const result = validateFieldValue(def, value);
    if (!result.valid) {
      errors.push({ key, message: result.message });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── D1 CRUD helpers ───────────────────────────────────────────────────────────

/** Raw D1 row type. */
interface RawFieldRow {
  fieldKey: string;
  value: string; // JSON-encoded
}

/**
 * Returns a FieldMap of all additional fields for a user.
 * Keys missing from the DB are NOT included in the result — the caller should
 * merge with defaults from FIELD_MAP[key].defaultValue as needed.
 */
export async function getAdditionalFields(
  db: D1Database,
  userId: string,
): Promise<FieldMap> {
  const rows = await db
    .prepare(
      `SELECT fieldKey, value FROM user_additional_fields WHERE userId = ? ORDER BY fieldKey ASC`,
    )
    .bind(userId)
    .all<RawFieldRow>()
    .catch(() => ({ results: [] as RawFieldRow[] }));

  const map: FieldMap = {};
  for (const row of rows.results ?? []) {
    try {
      map[row.fieldKey] = JSON.parse(row.value) as FieldValue;
    } catch {
      // Corrupted JSON — skip the row
    }
  }
  return map;
}

/**
 * Upserts multiple field values for a user in a single D1 batch.
 *
 * Values are serialised as JSON before storage.
 * null means "delete the field row" (revert to default).
 *
 * Returns the saved field map and any validation errors that were skipped.
 * Callers should validate BEFORE calling this; this function trusts the data.
 */
export async function setAdditionalFields(
  db: D1Database,
  userId: string,
  patch: FieldMap,
): Promise<{ saved: FieldMap; errors: FieldError[] }> {
  const errors: FieldError[] = [];
  const saved: FieldMap = {};

  const upsertStmt = db.prepare(
    `INSERT INTO user_additional_fields (id, userId, fieldKey, value, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId, fieldKey)
     DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  );

  const deleteStmt = db.prepare(
    `DELETE FROM user_additional_fields WHERE userId = ? AND fieldKey = ?`,
  );

  const now = Date.now();

  const stmts: D1PreparedStatement[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const def = FIELD_MAP[key];
    if (!def) {
      errors.push({ key, message: `Unknown field "${key}"` });
      continue;
    }

    if (value === null) {
      // Explicit null = delete the row (revert to default)
      stmts.push(deleteStmt.bind(userId, key));
      saved[key] = null;
    } else {
      let serialised: string;
      try {
        serialised = JSON.stringify(value);
      } catch {
        errors.push({ key, message: `Failed to serialise value for "${key}"` });
        continue;
      }
      const rowId = crypto.randomUUID();
      stmts.push(upsertStmt.bind(rowId, userId, key, serialised, now, now));
      saved[key] = value;
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`D1 batch failed: ${msg}`);
    });
  }

  return { saved, errors };
}

/**
 * Builds the full "hydrated" field map: DB values merged with definitions-defaults.
 * Every defined field has an entry in the result (null if unset and no default).
 */
export function hydrateFields(storedMap: FieldMap): FieldMap {
  const result: FieldMap = {};
  for (const def of FIELD_DEFINITIONS) {
    // Use `key in` so an explicit stored null is preserved (user cleared the field)
    // rather than falling back to the default value.
    result[def.key] = def.key in storedMap ? storedMap[def.key]! : def.defaultValue;
  }
  return result;
}

