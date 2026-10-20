/**
 * An application's logo in a square tile, or its first letter when it has none
 * (or the image fails to load). The URL comes straight from the applications
 * list, is versioned per upload and served immutable, so a list of these costs
 * one cached image request each and nothing per app on the API.
 */

import { useEffect, useState } from "react";

interface AppLogoProps {
  /** Used for the letter fallback; the image itself is decorative next to the name. */
  name: string;
  logoUrl?: string | null;
  /** Pixel size for width and height. Defaults to 40. */
  size?: number;
}

export function AppLogo({ name, logoUrl, size = 40 }: AppLogoProps) {
  const [failed, setFailed] = useState(false);

  // A new upload is a new URL; give it a chance to load.
  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const showImage = !!logoUrl && !failed;
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={showImage ? "app-logo app-logo-image" : "app-logo"}
      style={{ height: size, width: size, fontSize: Math.max(12, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
