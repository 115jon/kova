/**
 * Shared primitive UI components used by all SDK components.
 * Each renders a single HTML element with `data-ra-element` attributes
 * so they are fully targetable by the appearance API and external CSS.
 */

import React, { type CSSProperties, type ReactNode } from "react";
import type { AppearanceElements } from "../types";

// ── Spinner ────────────────────────────────────────────────────────────────────

export function Spinner({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <span
      data-ra-element="spinner"
      style={{ width: size, height: size, borderWidth: size / 7, ...style }}
      aria-label="Loading"
      role="status"
    />
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

export function Skeleton({
  width,
  height,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-ra-element="skeleton"
      style={{ width, height: height ?? 16, ...style }}
    />
  );
}

// ── Alert ─────────────────────────────────────────────────────────────────────

export function Alert({
  variant,
  children,
  style,
}: {
  variant: "error" | "success" | "info";
  children: ReactNode;
  style?: CSSProperties;
}) {
  if (!children) return null;
  return (
    <div
      data-ra-element="alertBanner"
      data-variant={variant}
      role={variant === "error" ? "alert" : "status"}
      style={style}
    >
      {children}
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

export function Divider({
  label = "or",
  elements,
}: {
  label?: string;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="dividerRow" style={elements?.dividerRow}>
      <div data-ra-element="dividerLine" style={elements?.dividerLine} />
      <span data-ra-element="dividerText" style={elements?.dividerText}>
        {label}
      </span>
      <div data-ra-element="dividerLine" style={elements?.dividerLine} />
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  error?: string | null;
  disabled?: boolean;
  elements?: AppearanceElements;
}

export function FormField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  error,
  disabled,
  elements,
}: FormFieldProps) {
  return (
    <div data-ra-element="formField" style={elements?.formField}>
      <label
        htmlFor={id}
        data-ra-element="formFieldLabel"
        style={elements?.formFieldLabel}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        data-ra-element="formFieldInput"
        style={{
          ...(error ? { borderColor: "var(--ra-color-error)" } : {}),
          ...elements?.formFieldInput,
        }}
      />
      {error && (
        <span
          id={`${id}-error`}
          data-ra-element="formFieldError"
          style={elements?.formFieldError}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}

// ── SubmitButton ───────────────────────────────────────────────────────────────

export function SubmitButton({
  isLoading,
  children,
  disabled,
  elements,
  style,
}: {
  isLoading?: boolean;
  children: ReactNode;
  disabled?: boolean;
  elements?: AppearanceElements;
  style?: CSSProperties;
}) {
  return (
    <button
      type="submit"
      disabled={disabled ?? isLoading}
      data-ra-element="formSubmitButton"
      style={{ ...elements?.formSubmitButton, ...style }}
    >
      {isLoading ? (
        <>
          <Spinner size={13} style={{ borderTopColor: "#fff" }} />
          Loading…
        </>
      ) : (
        children
      )}
    </button>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

export function Avatar({
  src,
  name,
  size = 32,
  style,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  style?: CSSProperties;
}) {
  const [imgError, setImgError] = React.useState(false);

  const initials = name
    ? name
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
    : "?";

  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    fontFamily: "var(--ra-font-mono)",
    fontWeight: 700,
    fontSize: size * 0.38,
    ...style,
  };

  if (src && !imgError) {
    return (
      <span style={base}>
        <img
          src={src}
          alt={name ?? "Avatar"}
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%" }}
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        background: "var(--ra-color-primary)",
        color: "#fff",
      }}
    >
      {initials}
    </span>
  );
}

// ── Card shell ────────────────────────────────────────────────────────────────

export function Card({
  children,
  elements,
  style,
  className,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      data-ra-element="card"
      data-ra-root
      style={{ ...elements?.card, ...style }}
      className={className}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  elements,
}: {
  title: string;
  subtitle?: string;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="cardHeader" style={elements?.cardHeader}>
      <h1 data-ra-element="cardTitle" style={elements?.cardTitle}>
        {title}
      </h1>
      {subtitle && (
        <p data-ra-element="cardSubtitle" style={elements?.cardSubtitle}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function CardBody({
  children,
  elements,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="cardBody" style={elements?.cardBody}>
      {children}
    </div>
  );
}

export function CardFooter({
  children,
  elements,
}: {
  children: ReactNode;
  elements?: AppearanceElements;
}) {
  return (
    <div data-ra-element="cardFooter" style={elements?.cardFooter}>
      {children}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function Tabs({
  tabs,
  active,
  onSelect,
  elements,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
  elements?: AppearanceElements;
}) {
  return (
    <div
      role="tablist"
      data-ra-element="tabsRoot"
      style={elements?.tabsRoot}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          data-ra-element="tab"
          style={
            active === tab.id
              ? { ...elements?.tab, ...elements?.tabActive }
              : elements?.tab
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
