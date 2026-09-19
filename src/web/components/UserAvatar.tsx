import { useState } from "react";

interface UserAvatarProps {
  /** URL from user.image (Google/Discord profile pic) — may be null */
  src?: string | null;
  /** Used for initials fallback and alt text */
  name?: string | null;
  /** Pixel size — defaults to 32 */
  size?: number;
  style?: React.CSSProperties;
}

/**
 * Shows the user's OAuth profile photo when available.
 * Falls back to a blue-tinted monogram square (maple-style) on error or absence.
 */
export function UserAvatar({ src, name, size = 32, style }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";
  const fontSize = size < 22 ? "0.58rem" : size < 32 ? "0.72rem" : size < 44 ? "0.88rem" : "1.1rem";
  // Square border-radius: 4px for small, 6px for larger
  const borderRadius = size < 30 ? 4 : 5;

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

  if (src && !imgError) {
    return (
      <div style={baseStyle}>
        <img
          src={src}
          alt={name ?? "User"}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          style={{ width: size, height: size, objectFit: "cover", borderRadius }}
        />
      </div>
    );
  }

  // Monogram fallback — blue accent tint, matching the .avatar CSS class aesthetic
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
