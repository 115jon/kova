-- Per-user wallpaper. One row per user. The image bytes live on the house CDN.
-- effect is a client-side render hint, not a server transform.
CREATE TABLE IF NOT EXISTS user_wallpapers (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  wallpaper_url TEXT,
  effect TEXT NOT NULL DEFAULT 'none' CHECK (
    effect IN ('none', 'dither', 'ascii', 'halftone', 'scanlines')
  ),
  updated_at INTEGER NOT NULL
);
