/**
 * Calls POST {CDN_URL}/scan/{cdnKey} on the CDN Worker (Workers AI endpoint).
 * Returns true  = image is safe to publish.
 * Returns false = image contains NSFW/explicit content and must be rejected.
 *
 * Intentionally fails open: if the scan endpoint is unreachable or the Workers AI
 * daily neuron quota is exhausted, we allow the upload so legitimate users are
 * never blocked by infrastructure issues.
 */
export async function scanUpload(
  cdnUrl: string,
  cdnApiKey: string,
  cdnKey: string
): Promise<boolean> {
  try {
    const res = await fetch(`${cdnUrl}/scan/${cdnKey}`, {
      method: "POST",
      headers: { "CDN-API-Key": cdnApiKey },
    });
    if (!res.ok) return true; // scan endpoint error → fail open
    const { safe } = (await res.json()) as { safe: boolean };
    return safe;
  } catch {
    return true; // network / parse error → fail open
  }
}

/**
 * Type-guard for a Blob / File-like object received from FormData.
 */
export function isFileLike(
  v: unknown
): v is { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof v === "object" &&
    v !== null &&
    "arrayBuffer" in v &&
    "type" in v &&
    "size" in v
  );
}

/** The CDN app all Kova uploads live under. */
export const CDN_APP = "kova-auth";

/**
 * The CDN object key of an asset that belongs to one application, from its
 * direct URL (`{cdn}/kova-auth/apps/{appId}/logo-ab12.webp`). Null for anything
 * else: share links, other hosts, another app's folder, other Kova assets
 * (`org-logos/`, `avatars/`), and any path that is not plain segments.
 *
 * This is what a delete is allowed to touch, so it is deliberately strict: the
 * stored URL is data, and a key built from it must not reach outside the folder.
 */
export function appAssetKey(cdnUrl: string, appId: string, assetUrl: string | null | undefined): string | null {
  if (!assetUrl || !/^[A-Za-z0-9_-]+$/.test(appId)) return null;
  const folder = `${CDN_APP}/apps/${appId}/`;
  const prefix = `${cdnUrl.replace(/\/+$/, "")}/${folder}`;
  if (!assetUrl.startsWith(prefix)) return null;
  const rest = assetUrl.slice(prefix.length).split(/[?#]/)[0] ?? "";
  // Plain name segments only: no empty or dot segments, no encoded or backslash separators.
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rest)) return null;
  if (rest.split("/").some((segment) => /^\.+$/.test(segment))) return null;
  return `${folder}${rest}`;
}

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The image type the bytes actually are, from their signature. A client's
 * Content-Type is a claim; this is what decides. JPEG (FF D8 FF), PNG
 * (89 50 4E 47) and WebP (RIFF....WEBP); anything else is null.
 */
export function sniffImageType(bytes: Uint8Array): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
  const at = (offset: number, ...expected: number[]) => expected.every((byte, i) => bytes[offset + i] === byte);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}
