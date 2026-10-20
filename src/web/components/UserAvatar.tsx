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

/** The user's OAuth photo, or their initial in a round accent tile. */
export function UserAvatar({ src, name, size = 32, style }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";
  const sizing: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(12, Math.round(size * 0.42)),
    ...style,
  };

  return (
    <span className="avatar" style={sizing}>
      {src && !imgError ? (
        <img
          src={src}
          alt={name ?? "User"}
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
