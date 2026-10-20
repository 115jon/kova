import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch } from "../lib/router-search";
import { Route as resetRoute } from "./reset-password";
import { Route as signInRoute } from "./sign-in";
import { Route as signUpRoute } from "./sign-up";

async function renderSignIn(search: string, page: "sign-in" | "sign-up" = "sign-in") {
  const root = createRootRoute({ component: Outlet });
  const base = page === "sign-in" ? signInRoute : signUpRoute;
  const route = base.update({ id: `/${page}`, path: `/${page}`, getParentRoute: () => root } as never);
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/${page}${search}`] }),
    parseSearch,
    stringifySearch,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

async function renderReset(search: string) {
  const root = createRootRoute({ component: Outlet });
  const route = resetRoute.update({ id: "/reset-password", path: "/reset-password", getParentRoute: () => root } as never);
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/reset-password${search}`] }),
    parseSearch,
    stringifySearch,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

describe("reset-password server render", () => {
  it.each(["?token=abc", "?error=INVALID_TOKEN"])("renders %s without an errored boundary", async (search) => {
    const html = await renderReset(search);
    expect(html).toContain("Reset your password");
    expect(html).not.toContain("<!--$!-->");
  });
});

describe("sign-in server render", () => {
  it("renders Kova's own sign-in frame without an errored boundary", async () => {
    const html = await renderSignIn("");
    expect(html).toContain("app-auth-shell is-kova");
    expect(html).toContain("app-auth-placeholder");
    expect(html).not.toContain("<!--$!-->");
  });

  it("renders the app sign-in placeholder without an errored boundary", async () => {
    const html = await renderSignIn("?pk=pk_dev_x&redirect_url=float%3A%2F%2Fauth&state=1e5");
    expect(html).toContain("app-auth-placeholder");
    expect(html).not.toContain("<!--$!-->");
  });

  it("renders the sign-up page in the same frames", async () => {
    const kova = await renderSignIn("", "sign-up");
    expect(kova).toContain("app-auth-shell is-kova");
    expect(kova).not.toContain("<!--$!-->");
    const app = await renderSignIn("?pk=pk_dev_x&redirect_url=float%3A%2F%2Fauth", "sign-up");
    expect(app).toContain("app-auth-placeholder");
    expect(app).not.toContain("<!--$!-->");
  });
});
