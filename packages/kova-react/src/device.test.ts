import { describe, expect, it } from "vitest";
import {
  approveUrl,
  challengeCreateUrl,
  challengePollUrl,
  isDeviceChallengeId,
  resolveApproveUrl,
} from "./device";

describe("kova device client", () => {
  it("accepts real challenge ids", () => {
    expect(isDeviceChallengeId("dc_fTXm7tqnkU_rNIoNCB8IQbRVf6L26znK6Yj2OG8Ywyk")).toBe(true);
    expect(isDeviceChallengeId("dc_short")).toBe(false);
    expect(isDeviceChallengeId("nope")).toBe(false);
  });

  it("builds kova urls", () => {
    expect(challengeCreateUrl("https://auth.115jon.site/")).toBe(
      "https://auth.115jon.site/api/device-challenges",
    );
    expect(challengePollUrl("https://auth.115jon.site", "dc_abc")).toBe(
      "https://auth.115jon.site/api/device-challenges/dc_abc",
    );
    expect(approveUrl("https://auth.115jon.site", "dc_abc")).toBe(
      "https://auth.115jon.site/approve/dc_abc",
    );
  });

  it("falls back to the approve path when the payload omits approveUrl", () => {
    expect(
      resolveApproveUrl({
        id: "dc_fTXm7tqnkU_rNIoNCB8IQbRVf6L26znK6Yj2OG8Ywyk",
        status: "pending",
      }),
    ).toBe("https://auth.115jon.site/approve/dc_fTXm7tqnkU_rNIoNCB8IQbRVf6L26znK6Yj2OG8Ywyk");
  });
});
