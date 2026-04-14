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
 * Falls back to a gradient initials bubble (same style as .avatar) on error or absence.
 */
export function UserAvatar({ src, name, size = 32, style }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";
  const fontSize = size < 24 ? "0.6rem" : size < 36 ? "0.8rem" : "1rem";

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
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
          style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%" }}
        />
      </div>
    );
  }

  // Initials fallback
  return (
    <div
      style={{
        ...baseStyle,
        background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
        color: "#fff",
        fontWeight: 700,
        fontSize,
      }}
    >
      {initial}
    </div>
  );
}
