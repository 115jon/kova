-- Extend the wallpaper effect contract without losing existing rows.
CREATE TABLE user_wallpapers_haze (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  wallpaper_url TEXT,
  effect TEXT NOT NULL DEFAULT 'none' CHECK (
    effect IN ('none', 'dither', 'ascii', 'halftone', 'scanlines', 'haze')
  ),
  updated_at INTEGER NOT NULL
);

INSERT INTO user_wallpapers_haze (user_id, wallpaper_url, effect, updated_at)
SELECT user_id, wallpaper_url, effect, updated_at FROM user_wallpapers;

DROP TABLE user_wallpapers;
ALTER TABLE user_wallpapers_haze RENAME TO user_wallpapers;
