/**
 * OrgAvatar — organization logo display component.
 *
 * Renders the org's uploaded logo (CDN URL) when available.
 * Falls back to a blue-accented monogram square (same aesthetic as UserAvatar)
 * if no logo is set or if the image fails to load.
 *
 * Props:
 *   name   – organization name, used for the initial fallback and alt text
 *   logo   – absolute CDN URL stored in organization.logo (may be null/undefined)
 *   size   – pixel dimension for both width and height (default 32)
 *   style  – optional extra CSSProperties forwarded to the root element
 *
 * Design decisions:
 *   - Square with small border-radius (4 px for ≤30 px, 5 px for larger)
 *     matching the UserAvatar border-radius scale.
 *   - Uses the project's CSS design tokens (--color-accent-dim, --color-accent,
 *     --color-border, --font-mono) so it always respects the theme.
 *   - referrerPolicy="no-referrer" on the <img> mirrors UserAvatar.
 *   - Error state resets if the `logo` prop changes (e.g. after a new upload).
 */

import { useEffect, useState } from "react";

interface OrgAvatarProps {
  /** Organization name — used for the initial fallback and img alt text. */
  name: string;
  /** Absolute CDN URL from organization.logo — null/undefined shows initials. */
  logo?: string | null;
  /** Pixel size for width and height. Defaults to 32. */
  size?: number;
  /** Additional inline styles forwarded to the root element. */
  style?: React.CSSProperties;
}

export function OrgAvatar({ name, logo, size = 32, style }: OrgAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Reset error whenever the logo URL changes (e.g. after a fresh upload)
  useEffect(() => {
    setImgError(false);
  }, [logo]);

  // Scale border-radius with size, matching UserAvatar
  const borderRadius = size < 30 ? 4 : 5;

  // Compute monogram font size to fill roughly 44% of the container
  const fontSize =
    size < 22 ? "0.58rem" : size < 32 ? "0.72rem" : size < 44 ? "0.88rem" : "1.1rem";

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...style,
  };

  // Render the actual logo when we have a URL and haven't hit an error
  if (logo && !imgError) {
    return (
      <div style={baseStyle}>
        <img
          src={logo}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          style={{
            width: size,
            height: size,
            objectFit: "cover",
            borderRadius,
            display: "block",
          }}
        />
      </div>
    );
  }

  // Monogram fallback — same blue-accent tint as UserAvatar
  const initial = (name ?? "O")[0]?.toUpperCase() ?? "O";
  return (
    <div
      style={{
        ...baseStyle,
        background: "var(--color-accent-dim)",
        border: "1px solid rgba(59,130,246,0.2)",
        color: "var(--color-accent)",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize,
        letterSpacing: "-0.02em",
      }}
    >
      {initial}
    </div>
  );
}
