/**
 * Shared primitive UI components used by all SDK components.
 * Each renders a single HTML element with `data-ra-element` attributes
 * so they are fully targetable by the appearance API and external CSS.
 */

import React, { type CSSProperties, type ReactNode } from "react";
import { useKovaAuth } from "../context";
import type { AppearanceElements } from "../types";

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// ── Spinner ────────────────────────────────────────────────────────────────────

export function Spinner({
  size = 14,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <output
      data-ra-element="spinner"
      style={{ width: size, height: size, borderWidth: size / 7, ...style }}
      aria-label="Loading"
      aria-live="polite"
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
// Status colour never travels alone: each variant carries its own icon.

const ALERT_ICON_PATHS: Record<"error" | "success" | "info", ReactNode> = {
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
};

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
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        data-ra-alert-icon=""
      >
        {ALERT_ICON_PATHS[variant]}
      </svg>
      <span>{children}</span>
    </div>
  );
}

// ── RateLimitBanner ────────────────────────────────────────────────────────────
//
// Shown when a 429 Too Many Requests response is received.
// Displays:
//   • An error-toned banner with a lock icon
//   • A live countdown: "Try again in Xs"
//   • An animated progress bar that depletes as the cooldown expires
//
// Props:
//   secondsRemaining — current tick from `useRateLimit().secondsRemaining`
//   totalSeconds     — the original Retry-After value; used to compute bar %
//
// Renders nothing when secondsRemaining ≤ 0.

export function RateLimitBanner({
  secondsRemaining,
  totalSeconds,
}: {
  secondsRemaining: number;
  totalSeconds: number;
}) {
  if (secondsRemaining <= 0) return null;

  const safeTotal = Math.max(1, totalSeconds);
  const progress = Math.min(1, secondsRemaining / safeTotal); // 1 → 0 (full → empty)

  const message =
    secondsRemaining === 1
      ? "Too many attempts. Try again in 1 second."
      : `Too many attempts. Try again in ${secondsRemaining}s.`;

  return (
    <div
      data-ra-element="rateLimitBanner"
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <div data-ra-rate-limit-row="">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>{message}</span>
      </div>

      {/* Depletes once per second as the countdown ticks: bounded, not a loop. */}
      <div aria-hidden="true" data-ra-rate-limit-track="">
        <div data-ra-rate-limit-fill="" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <progress
        value={secondsRemaining}
        max={safeTotal}
        aria-label={`Rate limit countdown: ${secondsRemaining} seconds remaining`}
        style={visuallyHiddenStyle}
      />
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
      aria-busy={isLoading || undefined}
      data-ra-element="formSubmitButton"
      style={{ ...elements?.formSubmitButton, ...style }}
    >
      {isLoading && <Spinner size={14} />}
      {children}
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
    fontFamily: "var(--ra-font)",
    fontWeight: 600,
    fontSize: Math.max(12, Math.round(size * 0.4)),
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
          style={{
            width: size,
            height: size,
            objectFit: "cover",
            borderRadius: "50%",
          }}
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

// ── Branding badge ────────────────────────────────────────────────────────────
// Shown in card footer unless the app has a paid plan with hide_branding = true.

function KovaAuthBranding() {
  const { serverAppearance } = useKovaAuth();
  if (serverAppearance?.hideBranding) return null;
  return (
    <a
      href="https://auth.115jon.site"
      target="_blank"
      rel="noopener noreferrer"
      data-ra-element="brandingBadge"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#0283a7" />
        <path d="M8.5 7v10M15.5 7.5 11 12l4.5 4.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Secured by Kova
    </a>
  );
}

// ── Development-mode badge ─────────────────────────────────────────────────────
// Shown at the bottom of every sign-in/sign-up card for pk_dev_/pk_test_ apps.

function DevModeBadge() {
  const { mode } = useKovaAuth();
  if (mode !== "test") return null;
  return (
    <div data-ra-element="devModeBadge">
      <span aria-hidden="true" data-ra-dev-dot="" />
      Development instance
    </div>
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
  const { serverAppearance } = useKovaAuth();
  const logoUrl = serverAppearance?.logoUrl;
  const logoAlt = `${serverAppearance?.displayName ?? "Application"} logo`;

  return (
    <div data-ra-element="cardHeader" style={elements?.cardHeader}>
      {logoUrl && (
        <img
          src={logoUrl}
          alt={logoAlt}
          data-ra-element="appLogo"
          style={elements?.appLogo}
        />
      )}
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
      {/* Branding + dev badge injected at the bottom of every footer */}
      <div data-ra-footer-badges="">
        <KovaAuthBranding />
        <DevModeBadge />
      </div>
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
    <div role="tablist" data-ra-element="tabsRoot" style={elements?.tabsRoot}>
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
