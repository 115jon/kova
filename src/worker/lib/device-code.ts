/**
 * User-code and device-context helpers for per-app device sign-in (RFC 8628).
 *
 * Better Auth's device-authorization plugin owns the codes and their state
 * (see lib/device-authorization.ts). This file only covers what Kova adds
 * around it: the XXXX-XXXX display form, the hosted /device return path, the
 * per-app verification URI, and cleaning device-supplied labels.
 *
 * Never put the device code in a URL, an HTML page, or a log line.
 */

export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_CODE_INTERVAL_SECONDS = 5;
export const DEVICE_LABEL_MAX = 128;

/** Better Auth's default user-code alphabet: no 0/O/1/I. */
export const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DISPLAY_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/** Strip separators and uppercase. Null unless exactly 8 characters of the alphabet. */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  if (compact.length !== 8) return null;
  for (const char of compact) {
    if (!USER_CODE_ALPHABET.includes(char)) return null;
  }
  return compact;
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;
}

/** `dvc_` + 256 random bits, base64url. The prefix keeps the pre-1.7 shape. */
export function generateDeviceCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `dvc_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;
}

/** Device-supplied text for display: control characters removed, trimmed, capped. */
export function clipDeviceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, DEVICE_LABEL_MAX).join("");
}

/**
 * Same-origin sign-in return for the hosted /device page. Path only, one
 * `code` query in display form. Rejects schemes, protocol-relative URLs, and
 * extra parameters.
 */
export function isSafeDeviceReturnPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!/^\/device\?code=[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(path)) return false;
  if (path.length > 80) return false;
  if (path.includes("\\") || path.includes("//") || path.includes("@")) return false;
  let url: URL;
  try {
    url = new URL(path, "https://device.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://device.invalid") return false;
  if (url.pathname !== "/device") return false;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "code") return false;
  const code = url.searchParams.get("code");
  return code !== null && DISPLAY_CODE_RE.test(code);
}

export function deviceReturnPath(userCode: unknown): string | null {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) return null;
  const path = `/device?code=${formatUserCode(normalized)}`;
  return isSafeDeviceReturnPath(path) ? path : null;
}

/** https://{slug}.{auth host}/device, or null when the app has no hosted host. */
export function hostedVerificationUri(authUrl: string, slug: string | null | undefined): string | null {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  let base: URL;
  try {
    base = new URL(authUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return `${base.protocol}//${slug}.${base.host}/device`;
}
