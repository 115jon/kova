import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../applications";
import { appsRouter } from "./apps";

const getSession = vi.fn(async () => ({ user: { id: "admin-1", role: "admin" } }));
const updateApplication = vi.fn(async (_db: unknown, _id: string, _input: Record<string, unknown>) => application);

vi.mock("../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));
vi.mock("../applications", async (original) => ({
  ...await original<typeof import("../applications")>(),
  getApplicationById: async () => application,
  updateApplication: (db: unknown, id: string, input: Record<string, unknown>) => updateApplication(db, id, input),
}));

const application = {
  id: "app-1", name: "Test", environment: "production", publishable_key: "pk_test",
  allowed_origins: ["https://consumer.example"], redirect_uris: ["https://consumer.example/callback"],
} as Application;

const env = { DB: {}, KV: { delete: async () => undefined } } as unknown as Env;

const patch = (body: unknown) =>
  appsRouter.request("/app-1", { method: "PATCH", body: JSON.stringify(body) }, env);

beforeEach(() => updateApplication.mockClear());

describe("PATCH /api/admin/apps/:id branding", () => {
  it.each([
    ["terms_url", "javascript:alert(1)"],
    ["privacy_url", "data:text/html,<script>1</script>"],
    ["home_url", "/relative"],
    ["home_url", "not a url"],
    ["terms_url", 42],
    ["primary_color", "red"],
    ["primary_color", "#12"],
    ["background_color", "#123456789"],
    ["background_color", "#ggg"],
    ["primary_color", "#fff;background:url(//evil.example)"],
    ["background_color", ""],
    ["primary_color", 0xffffff],
  ])("rejects %s = %j", async (field, value) => {
    const response = await patch({ [field]: value });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining(field) });
    expect(updateApplication).not.toHaveBeenCalled();
  });

  it("stores valid values, trims URLs and turns empty URLs into null", async () => {
    const response = await patch({
      home_url: " https://consumer.example ",
      terms_url: "http://localhost:3000/terms",
      privacy_url: "",
      primary_color: "#3B82F6",
      background_color: "#0f0",
    });
    expect(response.status).toBe(200);
    expect(updateApplication.mock.calls[0]![2]).toMatchObject({
      home_url: "https://consumer.example",
      terms_url: "http://localhost:3000/terms",
      privacy_url: null,
      primary_color: "#3B82F6",
      background_color: "#0f0",
    });
  });

  it("allows clearing with null and leaves omitted fields unchanged", async () => {
    await patch({ terms_url: null, background_color: null, name: "Renamed" });
    const input = updateApplication.mock.calls[0]![2];
    expect(input).toMatchObject({ terms_url: null, background_color: null, name: "Renamed" });
    expect(input.home_url).toBeUndefined();
    expect(input.primary_color).toBeUndefined();
  });
});
