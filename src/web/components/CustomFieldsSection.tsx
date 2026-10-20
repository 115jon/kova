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
        <div className="row" style={{ flex: 1 }}>
          <span className={currentValue !== null ? "" : "text-tertiary"}>
            {currentValue !== null ? String(currentValue) : "(not set)"}
          </span>
          <span className="badge badge-warning">
            <Lock aria-hidden="true" /> Admin managed
          </span>
        </div>
      );
    }

    if (def.type === "boolean") {
      const checked = draft === "true";
      return (
        <button
          id={`field-${def.key}-toggle`}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={def.label}
          onClick={() => setDraft(checked ? "false" : "true")}
          className="switch"
          title={checked ? "Enabled (click to disable)" : "Disabled (click to enable)"}
        />
      );
    }

    if (def.type === "enum" && def.options) {
      return (
        <select
          id={`field-${def.key}-select`}
          aria-label={def.label}
          className="select"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, maxWidth: 280 }}
        >
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {def.key === "locale" ? localeLabel(opt) : opt}
            </option>
          ))}
        </select>
      );
    }

    // Default: text / number input
    return (
      <input
        id={`field-${def.key}-input`}
        aria-label={def.label}
        className="input"
        type={def.type === "number" ? "number" : "text"}
        value={draft}
        maxLength={def.maxLength}
        aria-invalid={status === "error" || undefined}
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
        style={{ flex: 1, maxWidth: 320 }}
      />
    );
  };

  return (
    <div className="stack-sm" style={{
      padding: "12px var(--space-5)",
      borderBottom: "1px solid var(--color-border)",
    }}>
      {/* Label row */}
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="min-w-0">
          <p className="text-strong">{def.label}</p>
          <p className="text-sm text-tertiary">
            {def.description}
            {def.maxLength && ` · max ${def.maxLength} chars`}
          </p>
        </div>

        {/* Status badge */}
        {status === "saved" && (
          <span className="badge badge-success" role="status">
            <Check aria-hidden="true" /> Saved
          </span>
        )}
      </div>

      {/* Input + action row */}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {renderInput()}

        {def.selfEditable && (
          <>
            {/* Save button — only visible when dirty */}
            {isDirty && (
              <button
                id={`field-${def.key}-save`}
                type="button"
                className="btn btn-primary btn-sm"
                disabled={status === "saving"}
                onClick={() => void handleSave()}
              >
                {status === "saving"
                  ? <><RefreshCw className="spin" /> Saving…</>
                  : <><Save /> Save</>
                }
              </button>
            )}

            {/* Reset to default — only visible when not at the default already */}
            {!isAtDefault && def.defaultValue !== null && (
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={status === "saving"}
                onClick={() => void handleReset()}
                title={`Reset to default: ${def.defaultValue}`}
              >
                <RefreshCw /> Reset
              </button>
            )}
          </>
        )}
      </div>

      {/* Error message */}
      {status === "error" && errorMsg && (
        <p className="form-error" role="alert"><AlertCircle /> {errorMsg}</p>
      )}

      {/* Character count for long text */}
      {def.type === "string" && def.maxLength && draft.length > 0 && def.selfEditable && (
        <div
          className={draft.length > def.maxLength * 0.9 ? "text-sm text-warning tabular" : "text-sm text-tertiary tabular"}
          style={{ textAlign: "end" }}
        >
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
    label: "Application (admin managed)",
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
      <div className="skeleton-rows" role="status" aria-label="Loading profile fields">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="panel-body">
        <p className="alert alert-danger" role="alert">
          <AlertCircle />
          Failed to load field definitions: {schemaError.message}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Intro banner */}
      <div className="row" style={{
        alignItems: "flex-start",
        gap: 10,
        padding: "12px var(--space-5)",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-accent-soft)",
      }}>
        <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "var(--color-accent-text)" }} />
        <p className="text-sm text-secondary">
          These fields are stored as extensible metadata on your account.
          They are accessible to applications via the API.
          Fields marked as <strong className="text-strong">Admin managed</strong> are
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
            <div className="row text-overline" style={{
              padding: "8px var(--space-5)",
              background: "var(--color-surface-raised)",
              borderBottom: "1px solid var(--color-border)",
            }}>
              <span aria-hidden="true" style={{ display: "inline-flex" }}>{group.icon}</span>
              <span>{group.label}</span>
            </div>

            {/* Fields */}
            {groupDefs.map((def) => (
              <FieldRow
                key={def.key}
                def={def}
                currentValue={fieldValues[def.key] ?? def.defaultValue}
                onSave={handleSave}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
