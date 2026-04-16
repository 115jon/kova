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

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
