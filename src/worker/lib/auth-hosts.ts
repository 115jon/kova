/**
 * Kova can answer on more than one root auth host while it moves domains:
 * AUTH_URL is the canonical host, AUTH_ALT_URLS lists the others
 * (comma-separated origins, e.g. "https://auth.115jon.com").
 *
 * Everything host-derived (Better Auth baseURL and host-only cookies, slug
 * hosts, passkey rpID and origins, the OIDC issuer, links in emails, device
 * verification URLs) reads env.AUTH_URL. So a request that arrives on an
 * alternate host, or on one of its {slug}.auth… subdomains, gets an env whose
 * AUTH_URL is that host. Each host is then self-consistent: a sign-in that
 * starts on auth.115jon.com stays on auth.115jon.com.
 *
 * Requests that match no alternate host (the canonical host, app custom
 * domains, queue messages) keep env unchanged.
 */

function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The alternate auth origins from AUTH_ALT_URLS, minus junk and the canonical one. */
export function alternateAuthOrigins(env: { AUTH_URL?: string; AUTH_ALT_URLS?: string }): string[] {
  if (!env.AUTH_ALT_URLS) return [];
  const canonical = env.AUTH_URL ? originOf(env.AUTH_URL) : null;
  const canonicalHost = canonical ? new URL(canonical).hostname : null;
  const origins = new Set<string>();
  for (const part of env.AUTH_ALT_URLS.split(",")) {
    const origin = originOf(part);
    if (!origin) continue;
    const host = new URL(origin).hostname;
    // A host that contains, or sits under, the canonical one would capture its
    // requests (or its slug hosts) and rewrite AUTH_URL for them.
    if (canonicalHost && (host === canonicalHost || canonicalHost.endsWith(`.${host}`) || host.endsWith(`.${canonicalHost}`))) continue;
    origins.add(origin);
  }
  return [...origins];
}

/** The alternate origin that `hostname` is, or is a subdomain of. */
export function matchAlternateAuthOrigin(
  env: { AUTH_URL?: string; AUTH_ALT_URLS?: string },
  hostname: string,
): string | null {
  const host = hostname.toLowerCase();
  for (const origin of alternateAuthOrigins(env)) {
    const altHost = new URL(origin).hostname;
    if (host === altHost || host.endsWith(`.${altHost}`)) return origin;
  }
  return null;
}

/**
 * env as seen by a request for `hostname`. On an alternate host, AUTH_URL
 * becomes that host's origin, and so does DASHBOARD_URL when it named the
 * canonical auth host (the dashboard shares the auth origin). Returns the
 * original object when nothing changes.
 */
export function envForHost<E extends { AUTH_URL: string; DASHBOARD_URL?: string; AUTH_ALT_URLS?: string }>(
  env: E,
  hostname: string,
): E {
  const alternate = matchAlternateAuthOrigin(env, hostname);
  if (!alternate) return env;

  const canonical = originOf(env.AUTH_URL);
  const dashboard = env.DASHBOARD_URL ? originOf(env.DASHBOARD_URL) : null;
  // The other hosts stay listed, so first-party checks (staticOrigins) still
  // know every Kova host whichever one served the request.
  const others = [canonical, ...alternateAuthOrigins(env)].filter((o): o is string => !!o && o !== alternate);
  return {
    ...env,
    AUTH_URL: alternate,
    AUTH_ALT_URLS: others.join(","),
    ...(dashboard && dashboard === canonical ? { DASHBOARD_URL: alternate } : {}),
  };
}

/** Paths that keep answering on an old host while it redirects: API, discovery, health. */
const LEGACY_API_PATH = /^\/(?:api\/|\.well-known\/|health$)/;

/**
 * With AUTH_REDIRECT_ALT_PAGES = "true", a page request (GET/HEAD) on an
 * alternate root host is sent 301 to the same path on AUTH_URL. API,
 * discovery and health paths, and {slug}.auth… hosts, keep working there for
 * deployed clients that still call the old host.
 */
export function legacyPageRedirect(
  env: { AUTH_URL?: string; AUTH_ALT_URLS?: string; AUTH_REDIRECT_ALT_PAGES?: string },
  request: Request,
): Response | null {
  if (env.AUTH_REDIRECT_ALT_PAGES !== "true" || !env.AUTH_URL) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const alternate = matchAlternateAuthOrigin(env, url.hostname);
  if (!alternate || new URL(alternate).hostname !== url.hostname) return null;
  if (LEGACY_API_PATH.test(url.pathname)) return null;
  const canonical = originOf(env.AUTH_URL);
  if (!canonical) return null;
  return Response.redirect(`${canonical}${url.pathname}${url.search}`, 301);
}
