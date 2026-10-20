/**
 * Organization logo, or the org's initial in a rounded-square accent tile.
 * Square (not round) so orgs read differently from people at a glance.
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

  // A fresh upload gets a new URL; give it a chance to load.
  useEffect(() => {
    setImgError(false);
  }, [logo]);

  const initial = (name ?? "O")[0]?.toUpperCase() ?? "O";
  const sizing: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size < 32 ? "var(--radius-sm)" : "var(--radius-md)",
    fontSize: Math.max(12, Math.round(size * 0.42)),
    ...style,
  };

  return (
    <span className="avatar avatar-square" style={sizing}>
      {logo && !imgError ? (
        <img
          src={logo}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
