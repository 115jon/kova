import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";

/**
 * The router JSON-parses every search value, so `state=1e5` arrives as the
 * number 100000 and `state=null` as null. These values are opaque strings the
 * app gets back unchanged, so they skip JSON in both directions. Both halves
 * are needed: the router rewrites the URL from what it parsed.
 */
const OPAQUE_KEYS = new Set(["state", "redirect_url"]);

export function parseSearch(searchStr: string): Record<string, unknown> {
  const search = defaultParseSearch(searchStr) as Record<string, unknown>;
  const raw = new URLSearchParams(searchStr);
  for (const key of OPAQUE_KEYS) {
    const values = raw.getAll(key);
    if (values.length === 1) search[key] = values[0];
  }
  return search;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    if (OPAQUE_KEYS.has(key) && typeof value === "string") {
      params.set(key, value);
      continue;
    }
    const encoded = new URLSearchParams(defaultStringifySearch({ [key]: value })).get(key);
    if (encoded !== null) params.set(key, encoded);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
