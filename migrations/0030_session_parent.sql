-- ── Migration 0030: Per-browser app sessions ──────────────────────────────────
--
-- App-scoped sessions (`app_id` set) are minted from the browser's auth-domain
-- cookie session. They were reused per (userId, app_id), so every browser and
-- device signed into an app as the same user received the same token, and
-- revoking it on one device signed the user out everywhere.
--
-- `parent_session_id` records the cookie session that minted the app session.
-- POST /session-token now reuses only a session minted for the caller's own
-- cookie session. NULL means a standalone token (rows from before this
-- migration, device-code approvals, native-app handoffs, hosted subdomain
-- cookies): it keeps working for whoever holds it, and is never handed out.
--
-- No REFERENCES clause on purpose. Sign-out is per app: deleting the parent
-- (sign-out, or Better Auth's multi-session plugin replacing the browser's
-- session on a same-user sign-in) must not revoke the app sessions it minted.
ALTER TABLE session ADD COLUMN parent_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_session_parent_app ON session (parent_session_id, app_id);
