/**
 * The hand-written migrations must give Better Auth every table, column and
 * index its configured plugins expect, with no NOT NULL column it never
 * writes. This is `better-auth generate` run against migrations/ — a Better
 * Auth upgrade or new plugin that needs schema fails here, not in production.
 */
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { createAuth } from "./auth";
import { memoryKV, migratedD1 } from "./test-support/d1";

describe("D1 schema vs Better Auth", () => {
  it("has nothing left for Better Auth to create, add, or complain about", async () => {
    const { db } = migratedD1();
    const env = {
      AUTH_URL: "https://auth.115jon.site",
      DASHBOARD_URL: "https://auth.115jon.site",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "g",
      DB: db,
      KV: memoryKV().kv,
    } as unknown as Env;

    const plan = await getMigrations(createAuth(env).options, { throwOnUnsafe: false });

    expect(plan.toBeCreated.map((table) => table.table)).toEqual([]);
    expect(plan.toBeAdded.map((table) => `${table.table}: ${Object.keys(table.fields).join(", ")}`)).toEqual([]);
    expect(plan.toBeAddedIndexes.map((index) => index.name)).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
  });
});
