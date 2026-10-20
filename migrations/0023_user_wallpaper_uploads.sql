-- Durable per-user wallpaper library. Bytes remain on the house CDN.
CREATE TABLE IF NOT EXISTS user_wallpaper_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_wallpaper_uploads_user_created
  ON user_wallpaper_uploads (user_id, created_at DESC, id DESC);

INSERT OR IGNORE INTO user_wallpaper_uploads (id, user_id, url, content_type, created_at)
SELECT
  'legacy-' || lower(hex(user_id)),
  user_id,
  wallpaper_url,
  CASE
    WHEN lower(wallpaper_url) LIKE '%.jpg' OR lower(wallpaper_url) LIKE '%.jpeg' THEN 'image/jpeg'
    WHEN lower(wallpaper_url) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(wallpaper_url) LIKE '%.gif' THEN 'image/gif'
    ELSE 'image/png'
  END,
  updated_at
FROM user_wallpapers
WHERE wallpaper_url IS NOT NULL;
