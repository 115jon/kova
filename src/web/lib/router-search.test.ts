import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { searchParamString } from "./sign-in-redirect";
import { parseSearch, stringifySearch } from "./router-search";

describe("opaque sign-in search values", () => {
  it.each(["1e5", "null", "true", "007", "1.0", '"quoted"', "{}"])("keeps state=%s as typed", (state) => {
    const search = new URLSearchParams({ pk: "pk_dev_x", redirect_url: "float://auth", state });
    expect(parseSearch(`?${search}`)).toMatchObject({ pk: "pk_dev_x", redirect_url: "float://auth", state });
  });

  it("still parses other values the way the router does", () => {
    expect(parseSearch("?add_account=1&page=2&flag=true&name=abc")).toEqual({
      add_account: 1,
      page: 2,
      flag: true,
      name: "abc",
    });
  });

  it("writes opaque strings back without JSON quoting and keeps key order", () => {
    const query = "?pk=pk_dev_x&redirect_url=float%3A%2F%2Fauth&state=1e5&add_account=1";
    expect(stringifySearch(parseSearch(query))).toBe(query);
    expect(stringifySearch({ state: "null", extra: { a: 1 }, skipped: undefined })).toBe(
      "?state=null&extra=%7B%22a%22%3A1%7D",
    );
  });

  it("survives the router's canonical URL rewrite on a numeric-looking state", async () => {
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: "/sign-in",
      validateSearch: (search: Record<string, unknown>) => ({
        pk: searchParamString(search.pk),
        redirect_url: searchParamString(search.redirect_url),
        state: searchParamString(search.state),
      }),
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ["/sign-in?pk=pk_dev_x&redirect_url=float%3A%2F%2Fauth&state=1e5"] }),
      parseSearch,
      stringifySearch,
    });
    await router.load();

    expect(router.state.matches.at(-1)?.search).toEqual({
      pk: "pk_dev_x",
      redirect_url: "float://auth",
      state: "1e5",
    });
    const canonical = router.buildLocation({
      to: router.latestLocation.pathname,
      search: true,
      params: true,
      hash: true,
      state: true,
      _includeValidateSearch: true,
    });
    expect(new URLSearchParams(canonical.searchStr).get("state")).toBe("1e5");
  });
});
