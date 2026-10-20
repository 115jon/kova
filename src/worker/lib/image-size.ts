/**
 * Header-only image sniffing. No decoder, no resize.
 * Used to reject wallpaper uploads past 4K before they hit the CDN.
 */

export interface ImageSize {
  width: number;
  height: number;
}

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function byteAt(bytes: Uint8Array, index: number): number | null {
  if (index < 0 || index >= bytes.length) return null;
  return bytes[index] ?? null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string | null {
  let out = "";
  for (let i = 0; i < length; i++) {
    const value = byteAt(bytes, start + i);
    if (value === null) return null;
    out += String.fromCharCode(value);
  }
  return out;
}

function u16be(bytes: Uint8Array, offset: number): number | null {
  const hi = byteAt(bytes, offset);
  const lo = byteAt(bytes, offset + 1);
  if (hi === null || lo === null) return null;
  return (hi << 8) | lo;
}

function u32be(bytes: Uint8Array, offset: number): number | null {
  const b0 = byteAt(bytes, offset);
  const b1 = byteAt(bytes, offset + 1);
  const b2 = byteAt(bytes, offset + 2);
  const b3 = byteAt(bytes, offset + 3);
  if (b0 === null || b1 === null || b2 === null || b3 === null) return null;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function positiveSize(width: number, height: number): ImageSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > 100_000 || height > 100_000) return null;
  return { width, height };
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (byteAt(bytes, i) !== PNG_SIGNATURE[i]) return null;
  }
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width === null || height === null) return null;
  return positiveSize(width, height);
}

function gifSize(bytes: Uint8Array): ImageSize | null {
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const w0 = byteAt(bytes, 6);
  const w1 = byteAt(bytes, 7);
  const h0 = byteAt(bytes, 8);
  const h1 = byteAt(bytes, 9);
  if (w0 === null || w1 === null || h0 === null || h1 === null) return null;
  return positiveSize(w0 | (w1 << 8), h0 | (h1 << 8));
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length) {
    while (byteAt(bytes, i) === 0xff) i++;
    const marker = byteAt(bytes, i);
    if (marker === null) return null;
    i++;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16be(bytes, i);
    if (length === null || length < 2 || i + length > bytes.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      const height = u16be(bytes, i + 3);
      const width = u16be(bytes, i + 5);
      if (width === null || height === null) return null;
      return positiveSize(width, height);
    }
    i += length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const w0 = byteAt(bytes, 24);
    const w1 = byteAt(bytes, 25);
    const w2 = byteAt(bytes, 26);
    const h0 = byteAt(bytes, 27);
    const h1 = byteAt(bytes, 28);
    const h2 = byteAt(bytes, 29);
    if (w0 === null || w1 === null || w2 === null || h0 === null || h1 === null || h2 === null) {
      return null;
    }
    return positiveSize(
      1 + (w0 | (w1 << 8) | (w2 << 16)),
      1 + (h0 | (h1 << 8) | (h2 << 16)),
    );
  }
  if (chunk === "VP8 ") {
    if (
      byteAt(bytes, 23) !== 0x9d ||
      byteAt(bytes, 24) !== 0x01 ||
      byteAt(bytes, 25) !== 0x2a
    ) {
      return null;
    }
    const w0 = byteAt(bytes, 26);
    const w1 = byteAt(bytes, 27);
    const h0 = byteAt(bytes, 28);
    const h1 = byteAt(bytes, 29);
    if (w0 === null || w1 === null || h0 === null || h1 === null) return null;
    return positiveSize((w0 | (w1 << 8)) & 0x3fff, (h0 | (h1 << 8)) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (byteAt(bytes, 20) !== 0x2f) return null;
    const b0 = byteAt(bytes, 21);
    const b1 = byteAt(bytes, 22);
    const b2 = byteAt(bytes, 23);
    const b3 = byteAt(bytes, 24);
    if (b0 === null || b1 === null || b2 === null || b3 === null) return null;
    const bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    return positiveSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (pngSize(bytes)) return "image/png";
  if (gifSize(bytes)) return "image/gif";
  if (jpegSize(bytes)) return "image/jpeg";
  if (webpSize(bytes)) return "image/webp";
  return null;
}

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? gifSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
}

/** 4K UHD in either orientation: long edge ≤ 3840 and short edge ≤ 2160. */
export function exceeds4k(width: number, height: number): boolean {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  return longEdge > 3840 || shortEdge > 2160;
}
