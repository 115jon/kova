import { useId } from "react";

interface KovaLogoProps {
  size?: number;
  className?: string;
  variant?: "icon" | "full";
  theme?: "gradient" | "monochrome";
  withBackground?: boolean;
}

// Brand colours live here as literals: the mark must look the same on every
// surface, including ones that never load the dashboard stylesheet.
const INK = "#131515";
const TEAL = "#0283a7";

export function KovaLogo({
  size = 32,
  className = "",
  variant = "icon",
  theme = "gradient",
  withBackground = true,
}: KovaLogoProps) {
  const gradientId = useId();
  const mono = theme === "monochrome";
  const paint = mono ? "currentColor" : `url(#${gradientId})`;

  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={variant === "icon" ? className : undefined}
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          {/* The K sits on an ink tile, so the ink end is lifted to stay visible. */}
          <stop offset="0%" stopColor={withBackground ? "#4fb8d6" : INK} />
          <stop offset="100%" stopColor={TEAL} />
        </linearGradient>
      </defs>
      {withBackground ? (
        <>
          <rect
            x="8" y="8" width="84" height="84" rx="22"
            fill={mono ? "none" : INK}
            stroke={mono ? "currentColor" : TEAL}
            strokeOpacity={mono ? 0.3 : 0.6}
            strokeWidth="1.5"
          />
          <rect x="31" y="27" width="10" height="46" rx="5" fill={paint} />
          <path
            d="M66,29 L49,46 C46.5,48.5 46.5,51.5 49,54 L66,71"
            stroke={paint}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <rect x="25" y="20" width="12" height="60" rx="6" fill={paint} />
          <path
            d="M67,23 L47,43 C43,47 43,53 47,57 L67,77"
            stroke={paint}
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );

  if (variant === "icon") return icon;

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {icon}
      <span style={{ fontSize: Math.max(15, Math.round(size * 0.62)), fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1 }}>
        Kova
      </span>
    </span>
  );
}
