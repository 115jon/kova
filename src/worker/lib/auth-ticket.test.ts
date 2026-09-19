import { describe, expect, it } from "vitest";
import {
  createSessionTransferCode,
  exchangeSessionTransferCode,
} from "./auth-ticket";

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

describe("session transfer origin binding", () => {
  it("exchanges only from the stored origin", async () => {
    const kv = memoryKv();
    const code = await createSessionTransferCode(
      kv,
      "session_tok",
      "pk_live_1",
      "https://app.example.com",
    );

    await expect(
      exchangeSessionTransferCode(kv, code, "pk_live_1", "https://evil.example"),
    ).resolves.toBeNull();

    const replay = await createSessionTransferCode(
      kv,
      "session_tok",
      "pk_live_1",
      "https://app.example.com",
    );
    await expect(
      exchangeSessionTransferCode(kv, replay, "pk_live_1", "https://app.example.com"),
    ).resolves.toEqual({ sessionToken: "session_tok" });
  });

  it("rejects a missing origin header", async () => {
    const kv = memoryKv();
    const code = await createSessionTransferCode(
      kv,
      "session_tok",
      "pk_live_1",
      "https://app.example.com",
    );
    await expect(
      exchangeSessionTransferCode(kv, code, "pk_live_1", null),
    ).resolves.toBeNull();
  });
});
