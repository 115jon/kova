import { describe, expect, it } from "vitest";
import { exceeds4k, readImageSize, sniffImageType } from "./image-size";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const segmentLength = 11;
  const bytes = new Uint8Array(2 + 2 + segmentLength);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[4] = 0x00;
  bytes[5] = segmentLength;
  bytes[6] = 8;
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  bytes[11] = 1;
  bytes[12] = 1;
  bytes[13] = 0x11;
  bytes[14] = 0;
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  bytes[6] = width & 0xff;
  bytes[7] = (width >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >> 8) & 0xff;
  return bytes;
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  const w = width - 1;
  const h = height - 1;
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0,
  ]);
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

describe("image headers", () => {
  it("reads png, jpeg, gif, and webp sizes", () => {
    expect(readImageSize(png(48, 32))).toEqual({ width: 48, height: 32 });
    expect(readImageSize(jpeg(100, 50))).toEqual({ width: 100, height: 50 });
    expect(readImageSize(gif(16, 9))).toEqual({ width: 16, height: 9 });
    expect(readImageSize(webp(3840, 2160))).toEqual({ width: 3840, height: 2160 });
    expect(sniffImageType(png(2, 2))).toBe("image/png");
    expect(sniffImageType(jpeg(2, 2))).toBe("image/jpeg");
    expect(sniffImageType(gif(2, 2))).toBe("image/gif");
    expect(sniffImageType(webp(2, 2))).toBe("image/webp");
  });

  it("rejects junk and enforces 4K in either orientation", () => {
    expect(readImageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(exceeds4k(3840, 2160)).toBe(false);
    expect(exceeds4k(2160, 3840)).toBe(false);
    expect(exceeds4k(3841, 2160)).toBe(true);
    expect(exceeds4k(3840, 2161)).toBe(true);
  });
});
