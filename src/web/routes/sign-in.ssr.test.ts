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
import { Route as signInRoute } from "./sign-in";

async function renderSignIn(search: string) {
  const root = createRootRoute({ component: Outlet });
  const route = signInRoute.update({ id: "/sign-in", path: "/sign-in", getParentRoute: () => root } as never);
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/sign-in${search}`] }),
    parseSearch,
    stringifySearch,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

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
});
