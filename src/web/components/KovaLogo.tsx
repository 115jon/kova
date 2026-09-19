import React from "react";

interface KovaLogoProps {
  size?: number;
  className?: string;
  variant?: "icon" | "full";
  theme?: "gradient" | "monochrome";
  withBackground?: boolean;
}

export function KovaLogo({
  size = 32,
  className = "",
  variant = "icon",
  theme = "gradient",
  withBackground = true,
}: KovaLogoProps) {
  // Brand color definition - Clean blue to cyan, absolute zero purple
  const fillColor = theme === "monochrome" ? "currentColor" : "url(#kova-brand-grad)";
  const strokeColor = theme === "monochrome" ? "currentColor" : "url(#kova-brand-grad)";
  const containerBg = "#09090b";
  const containerBorderColor = theme === "monochrome" ? "rgba(255,255,255,0.12)" : "rgba(59, 130, 246, 0.25)";

  const renderIcon = () => {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: "inline-block", verticalAlign: "middle" }}
      >
        <defs>
          <linearGradient id="kova-brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>

        {withBackground ? (
          <>
            {/* Outer Premium double-bezel Squircle Enclosure */}
            <rect
              x="8"
              y="8"
              width="84"
              height="84"
              rx="20"
              fill={containerBg}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1.5"
            />
            <rect
              x="8"
              y="8"
              width="84"
              height="84"
              rx="20"
              stroke={containerBorderColor}
              strokeWidth="1.5"
              strokeOpacity="0.8"
              fill="none"
            />

            {/* Inset shadow accent loop */}
            <rect
              x="10"
              y="10"
              width="80"
              height="80"
              rx="18"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="1"
              fill="none"
            />

            {/* Core K-Gateway centered beautifully inside the squircle */}
            <rect x="31" y="27" width="10" height="46" rx="5" fill={fillColor} />
            <path
              d="M66,29 L49,46 C46.5,48.5 46.5,51.5 49,54 L66,71"
              stroke={strokeColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : (
          <>
            {/* Standalone raw K-Gateway monogram */}
            <rect x="25" y="20" width="12" height="60" rx="6" fill={fillColor} />
            <path
              d="M67,23 L47,43 C43,47 43,53 47,57 L67,77"
              stroke={strokeColor}
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        )}
      </svg>
    );
  };

  if (variant === "icon") {
    return renderIcon();
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }} className={className}>
      {renderIcon()}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          fontSize: `${size * 0.44}px`,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        kova<span style={{ color: "var(--color-accent)" }}>auth</span>
      </span>
    </div>
  );
}
