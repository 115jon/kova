import { createRouter } from "@tanstack/react-router";
import { parseSearch, stringifySearch } from "./web/lib/router-search";
import { routeTree } from "./web/routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    scrollRestoration: true,
  });
}
