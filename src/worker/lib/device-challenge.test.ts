import { describe, expect, it } from "vitest";
import {
  approveDeviceChallenge,
  claimDeviceChallenge,
  clipLabel,
  createDeviceChallenge,
  denyDeviceChallenge,
  getDeviceChallenge,
  isDeviceChallengeId,
  toPublicView,
} from "./device-challenge";

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as never;
}

describe("device challenge", () => {
  it("creates an unguessable pending challenge", async () => {
    const kv = memoryKv();
    const created = await createDeviceChallenge(kv, {
      hostname: "joi",
      platform: "windows",
      label: "work pc",
    });

    expect(isDeviceChallengeId(created.id)).toBe(true);
    expect(created.status).toBe("pending");
    expect(created.approvalToken).toBeNull();
    expect(toPublicView(created)).not.toHaveProperty("approvalToken");
  });

  it("strips control characters from labels", () => {
    expect(clipLabel("  joi\n")).toBe("joi");
    expect(clipLabel("a".repeat(200))?.length).toBe(128);
    expect(clipLabel("   ")).toBeNull();
  });

  it("approves then yields the token once", async () => {
    const kv = memoryKv();
    const created = await createDeviceChallenge(kv, { hostname: "devbox" });
    const approved = await approveDeviceChallenge(kv, created.id, "user_1");
    expect(approved?.status).toBe("approved");
    expect(approved?.approvalToken?.startsWith("dat_")).toBe(true);

    const token = await claimDeviceChallenge(kv, created.id);
    expect(token).toBe(approved?.approvalToken);

    await expect(claimDeviceChallenge(kv, created.id)).resolves.toBeNull();
    const after = await getDeviceChallenge(kv, created.id);
    expect(after?.status).toBe("claimed");
    expect(after?.approvalToken).toBeNull();
  });

  it("cannot approve a denied challenge", async () => {
    const kv = memoryKv();
    const created = await createDeviceChallenge(kv);
    await denyDeviceChallenge(kv, created.id, "user_1");
    await expect(approveDeviceChallenge(kv, created.id, "user_1")).resolves.toBeNull();
  });

  it("rejects junk ids", async () => {
    const kv = memoryKv();
    await expect(getDeviceChallenge(kv, "../etc/passwd")).resolves.toBeNull();
    await expect(getDeviceChallenge(kv, "dc_short")).resolves.toBeNull();
  });
});
