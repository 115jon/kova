/**
 * The "This wasn't me" link in a sign-in alert email. The token is
 * `base64url(payload).base64url(HMAC-SHA256)` keyed with BETTER_AUTH_SECRET
 * over a purpose prefix plus the payload, so it cannot be confused with any
 * other signed value. It names the user, the alert, the expiry, and (for the
 * confirmation page) the app and sign-in time. Single use is enforced by the
 * caller with a KV marker on the alert id.
 */

export const NOT_ME_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PURPOSE = "kova:not-me:v1.";

export interface NotMePayload {
  /** User id. */
  u: string;
  /** Alert id (also the single-use key). */
  a: string;
  /** Expiry, epoch ms. */
  e: number;
  /** application.id of the sign-in, or null. */
  app: string | null;
  /** Sign-in time, epoch ms. */
  t: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signNotMeToken(secret: string, payload: NotMePayload): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(PURPOSE + body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** The payload of a well-formed, correctly signed, unexpired token; else null. */
export async function verifyNotMeToken(secret: string, token: string, now = Date.now()): Promise<NotMePayload | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const signatureBytes = base64UrlDecode(signature);
  const bodyBytes = base64UrlDecode(body);
  if (!signatureBytes || !bodyBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    signatureBytes,
    new TextEncoder().encode(PURPOSE + body),
  );
  if (!valid) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as Partial<NotMePayload>;
    if (
      typeof parsed.u !== "string" || !parsed.u ||
      typeof parsed.a !== "string" || !parsed.a ||
      typeof parsed.e !== "number" || !Number.isFinite(parsed.e) || parsed.e <= now ||
      typeof parsed.t !== "number" ||
      (parsed.app !== null && typeof parsed.app !== "string")
    ) return null;
    return { u: parsed.u, a: parsed.a, e: parsed.e, app: parsed.app, t: parsed.t };
  } catch {
    return null;
  }
}

/** KV key marking an alert's link as used. */
export function notMeUsedKey(alertId: string): string {
  return `not-me-used:${alertId}`;
}
