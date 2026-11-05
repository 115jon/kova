/**
 * One session lifetime for every Kova session: Better Auth's own (cookie and
 * bearer) and the app-scoped rows minted with raw SQL. 30 days, sliding: a
 * session used at least `SESSION_UPDATE_AGE_SECONDS` after its last refresh
 * gets a fresh 30 days.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
