/**
 * @file components/CustomFieldsSection.tsx
 * @description Self-service "Custom Fields" panel rendered inside Settings.
 *
 * ── Design goals ─────────────────────────────────────────────────────────────
 *
 *  1. Schema-driven: the component fetches field definitions from the server and
 *     renders the correct input type (text, select, toggle, number) without
 *     any field-specific branching in JSX.
 *
 *  2. Per-field, per-save UX: each field is independently editable.  Changes
 *     are saved with a dedicated "Save" button per row so partial updates
 *     are explicit.  A "Reset to default" action is available for each field.
 *
 *  3. Non-self-editable (admin-only) fields are displayed read-only with a
 *     "🔒 Admin managed" badge — the user can see the current value but cannot
 *     edit it here.
 *
 *  4. Optimistic UI via useUpdateMyFields() — edits apply instantly from the
 *     React Query cache; server confirms in sub-second time on Cloudflare.
 *
 *  5. Full error surfacing: per-field validation errors returned by the server
 *     are displayed inline below the input.
 */

import {
  type FieldDefPublic,
  type FieldError,
  type FieldValue,
  isFieldValidationError,
  useFieldSchema,
  useMyFields,
  useUpdateMyFields
} from "@/hooks/use-additional-fields";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Globe,
  Info,
  Lock,
  RefreshCw,
  Save,
  Sliders,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── Local helpers ─────────────────────────────────────────────────────────────

function localeLabel(code: string): string {
  const map: Record<string, string> = {
    en: "English",
    "en-GB": "English (UK)",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    ja: "日本語",
    zh: "中文",
    pt: "Português",
    ar: "العربية",
    ko: "한국어",
  };
  return map[code] ?? code;
}

// ── Field status indicator ────────────────────────────────────────────────────

type FieldStatus = "idle" | "saving" | "saved" | "error";

interface FieldState {
  draft: string;              // serialised draft value (always a string for inputs)
  status: FieldStatus;
  errorMsg: string;
}

/** Serialise any FieldValue to a string for input elements. */
function toInputString(value: FieldValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Parse a string back to the appropriate FieldValue based on the field type. */
function fromInputString(raw: string, type: FieldDefPublic["type"]): FieldValue {
  if (raw === "") return null;
  if (type === "boolean") return raw === "true";
  if (type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  return raw;
}

// ── Single field row ──────────────────────────────────────────────────────────

interface FieldRowProps {
  def: FieldDefPublic;
  currentValue: FieldValue;
  onSave: (key: string, value: FieldValue) => Promise<{ fieldErrors?: FieldError[] }>;
}

function FieldRow({ def, currentValue, onSave }: FieldRowProps) {
  const [draft, setDraft] = useState<string>(toInputString(currentValue));
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Keep draft in sync when currentValue changes from external invalidations
  useEffect(() => {
    setDraft(toInputString(currentValue));
  }, [currentValue]);

  const isDirty = draft !== toInputString(currentValue);
  const defaultStr = toInputString(def.defaultValue);
  const isAtDefault = draft === defaultStr;

  const handleSave = useCallback(async () => {
    setStatus("saving");
    setErrorMsg("");
    const value = fromInputString(draft, def.type);
    try {
      const result = await onSave(def.key, value);
      const fieldErr = result.fieldErrors?.find((e) => e.key === def.key);
      if (fieldErr) {
        setStatus("error");
        setErrorMsg(fieldErr.message);
      } else {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2500);
      }
    } catch (err: unknown) {
      setStatus("error");
      if (isFieldValidationError(err)) {
        const fe = err.fieldErrors.find((e) => e.key === def.key);
        setErrorMsg(fe?.message ?? err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
    }
  }, [def, draft, onSave]);

  const handleReset = useCallback(async () => {
    setDraft(defaultStr);
    setStatus("saving");
    setErrorMsg("");
    try {
      await onSave(def.key, def.defaultValue);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Reset failed");
    }
  }, [def, defaultStr, onSave]);

  const renderInput = () => {
    if (!def.selfEditable) {
      // Read-only display for admin-managed fields
      return (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.82rem",
            color: currentValue !== null ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          }}>
            {currentValue !== null ? String(currentValue) : "(not set)"}
          </span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.18)",
            borderRadius: 4,
            padding: "2px 7px",
            fontSize: "0.68rem",
            fontFamily: "var(--font-mono)",
            color: "var(--color-amber)",
            flexShrink: 0,
          }}>
            <Lock size={9} /> Admin managed
          </span>
        </div>
      );
    }

    if (def.type === "boolean") {
      const checked = draft === "true";
      return (
        <button
          id={`field-${def.key}-toggle`}
          role="switch"
          aria-checked={checked}
          onClick={() => setDraft(checked ? "false" : "true")}
          style={{
            width: 42,
            height: 24,
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            background: checked ? "var(--color-accent)" : "var(--color-surface-raised)",
            position: "relative",
            transition: "background 0.2s",
            outline: "none",
            flexShrink: 0,
          }}
          title={checked ? "Enabled (click to disable)" : "Disabled (click to enable)"}
        >
          <span style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }} />
        </button>
      );
    }

    if (def.type === "enum" && def.options) {
      return (
        <div style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: 280 }}>
          <select
            id={`field-${def.key}-select`}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "0.82rem",
              appearance: "none",
              paddingRight: 32,
            }}
          >
            {def.options.map((opt) => (
              <option key={opt} value={opt}>
                {def.key === "locale" ? localeLabel(opt) : opt}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-text-tertiary)",
              pointerEvents: "none",
            }}
          />
        </div>
      );
    }

    // Default: text / number input
    return (
      <input
        id={`field-${def.key}-input`}
        className="input"
        type={def.type === "number" ? "number" : "text"}
        value={draft}
        maxLength={def.maxLength}
        placeholder={
          def.defaultValue !== null
            ? `Default: ${def.defaultValue}`
            : def.description
        }
        onChange={(e) => {
          setDraft(e.target.value);
          if (status === "error") { setStatus("idle"); setErrorMsg(""); }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && isDirty && status !== "saving") {
            void handleSave();
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 320,
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
          borderColor: status === "error"
            ? "rgba(248,113,113,0.5)"
            : undefined,
        }}
      />
    );
  };

  return (
    <div style={{
      padding: "12px 20px",
      borderBottom: "1px solid var(--color-border)",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Label row */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontSize: "0.84rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            lineHeight: 1.3,
          }}>
            {def.label}
          </p>
          <p style={{
            fontSize: "0.72rem",
            color: "var(--color-text-tertiary)",
            fontFamily: "var(--font-mono)",
            marginTop: 2,
            lineHeight: 1.5,
          }}>
            {def.description}
            {def.maxLength && (
              <span style={{ marginLeft: 6, opacity: 0.6 }}>
                · max {def.maxLength} chars
              </span>
            )}
          </p>
        </div>

        {/* Status badge */}
        {status === "saved" && (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "0.72rem",
            fontFamily: "var(--font-mono)",
            color: "var(--color-green)",
            flexShrink: 0,
          }}>
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      {/* Input + action row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {renderInput()}

        {def.selfEditable && (
          <>
            {/* Save button — only visible when dirty */}
            {isDirty && (
              <button
                id={`field-${def.key}-save`}
                className="btn btn-primary"
                style={{ fontSize: "0.78rem", padding: "5px 12px" }}
                disabled={status === "saving"}
                onClick={() => void handleSave()}
              >
                {status === "saving"
                  ? <><RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
                  : <><Save size={11} /> Save</>
                }
              </button>
            )}

            {/* Reset to default — only visible when not at the default already */}
            {!isAtDefault && def.defaultValue !== null && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.75rem", padding: "5px 10px", color: "var(--color-text-tertiary)" }}
                disabled={status === "saving"}
                onClick={() => void handleReset()}
                title={`Reset to default: ${def.defaultValue}`}
              >
                <RefreshCw size={10} /> Reset
              </button>
            )}
          </>
        )}
      </div>

      {/* Error message */}
      {status === "error" && errorMsg && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-mono)",
          fontSize: "0.72rem",
          color: "var(--color-red)",
          background: "var(--color-red-dim)",
          border: "1px solid rgba(248,113,113,0.15)",
          borderRadius: 4,
          padding: "5px 10px",
        }}>
          <AlertCircle size={11} /> {errorMsg}
        </div>
      )}

      {/* Character count for long text */}
      {def.type === "string" && def.maxLength && draft.length > 0 && def.selfEditable && (
        <div style={{
          textAlign: "right",
          fontSize: "0.68rem",
          fontFamily: "var(--font-mono)",
          color: draft.length > def.maxLength * 0.9
            ? "var(--color-amber)"
            : "var(--color-text-tertiary)",
        }}>
          {draft.length} / {def.maxLength}
        </div>
      )}
    </div>
  );
}

// ── Section grouping ──────────────────────────────────────────────────────────

const FIELD_GROUPS: { label: string; icon: React.ReactNode; keys: string[] }[] = [
  {
    label: "Localisation",
    icon: <Globe size={12} />,
    keys: ["timezone", "locale"],
  },
  {
    label: "Identity",
    icon: <Info size={12} />,
    keys: ["display_name", "bio"],
  },
  {
    label: "Preferences",
    icon: <Sliders size={12} />,
    keys: ["theme", "email_notifications"],
  },
  {
    label: "Application (Admin Managed)",
    icon: <Lock size={12} />,
    keys: ["app_role", "department", "employee_id"],
  },
];

// ── Main exported component ────────────────────────────────────────────────────

export function CustomFieldsSection() {
  const { data: schemaDefs = [], isLoading: schemaLoading, error: schemaError } = useFieldSchema();
  const { data: fieldValues = {}, isLoading: valuesLoading } = useMyFields();
  const updateMutation = useUpdateMyFields();

  const isLoading = schemaLoading || valuesLoading;

  // Build a lookup map from the schema for O(1) access in FieldRow
  const defMap = useMemo(() =>
    Object.fromEntries(schemaDefs.map((d) => [d.key, d])),
    [schemaDefs],
  );

  // Stable save handler — creates the patch and returns FieldErrors
  const handleSave = useCallback(
    async (key: string, value: FieldValue) => {
      const result = await updateMutation.mutateAsync({ [key]: value });
      return { fieldErrors: result.partialErrors };
    },
    [updateMutation],
  );

  if (isLoading) {
    return (
      <div style={{
        padding: "28px 20px",
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "0.76rem",
        color: "var(--color-text-tertiary)",
      }}>
        <RefreshCw
          size={14}
          style={{ animation: "spin 1s linear infinite", marginBottom: 8, display: "block", margin: "0 auto 8px" }}
        />
        Loading profile fields…
      </div>
    );
  }

  if (schemaError) {
    return (
      <div style={{
        padding: 20,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-mono)",
        fontSize: "0.76rem",
        color: "var(--color-red)",
      }}>
        <AlertCircle size={13} />
        Failed to load field definitions: {schemaError.message}
      </div>
    );
  }

  return (
    <>
      {/* Intro banner */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 20px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-accent-dim)",
        borderTop: "none",
      }}>
        <Info size={13} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.72rem",
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
        }}>
          These fields are stored as extensible metadata on your account.
          They are accessible to applications via the API.
          Fields marked as <strong style={{ color: "var(--color-amber)" }}>Admin managed</strong> are
          set by platform administrators and are read-only here.
        </p>
      </div>

      {/* Grouped field rows */}
      {FIELD_GROUPS.map((group) => {
        const groupDefs = group.keys
          .map((k) => defMap[k])
          .filter((d): d is FieldDefPublic => !!d);

        if (groupDefs.length === 0) return null;

        return (
          <div key={group.label}>
            {/* Group header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 20px",
              background: "var(--color-surface-raised)",
              borderBottom: "1px solid var(--color-border)",
            }}>
              <span style={{ color: "var(--color-text-tertiary)" }}>{group.icon}</span>
              <span style={{
                fontSize: "0.68rem",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-text-tertiary)",
              }}>
                {group.label}
              </span>
            </div>

            {/* Fields */}
            {groupDefs.map((def) => (
              <FieldRow
                key={def.key}
                def={def}
                currentValue={def.key in fieldValues ? fieldValues[def.key] : def.defaultValue}
                onSave={handleSave}
              />
            ))}
          </div>
        );
      })}

      {/* Bottom padding */}
      <div style={{ padding: "10px 20px" }} />
    </>
  );
}
