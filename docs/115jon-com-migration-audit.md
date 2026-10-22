# 115jon.site → 115jon.com migration audit

Read-only audit from 2026-10-22, run across `F:\dev`. Nothing has been migrated yet.

## Before anything else

`kova`, `kova-main` and `ralph-auth-{live,methods,rest,mindloop}` are near-copies of `ralph-auth`, the canonical Kova repo. Archive them first. Otherwise they keep stale literals.

## Hostnames

| Host | Where | Type |
|---|---|---|
| `auth.115jon.site` | Kova `wrangler.toml` routes | config |
| | `cors.ts:88` `STATIC_ORIGINS` | hard-coded |
| | `device-challenges.ts:21` | hard-coded |
| | SDK `packages/kova-react/src/key.ts:17` (`KOVA_HOSTED_AUTH_URL`) | hard-coded default |
| | SDK `device.ts:6` (`DEFAULT_KOVA_URL`) | hard-coded default |
| | SDK `components/ui.tsx:391` | hard-coded |
| | many client apps (see Kova consumers) | mixed |
| `*.auth.115jon.site` | Kova route `*.auth.115jon.site/*` | config |
| | `mira-wulx5t.auth…` (zeron) | hard-coded in client |
| | `ralph-meet.auth…` (gpui) | hard-coded in client |
| `cdn.115jon.site` | Kova `CDN_URL` | config |
| | `JS/cdn` route and allowed origins | config |
| | `115jon-com` / `115jon-manish` `tokens.ts` | hard-coded |
| | `109ichiki-astro` (`works.json`, about 70 URLs) | hard-coded |
| | `jtcdn.mjs` | hard-coded |
| `meet.115jon.site` | ralph-meet `wrangler.toml` `REALTIME_ALLOWED_ORIGINS`, `.env.deployed`, Tauri CSPs | config |
| | `platform.ts`, `oembed.ts`, `share-preview-proxy.ts`, `VoiceListenTogetherManager.tsx`, instagram user agent | hard-coded |
| | ralph-meet-gpui `client.rs:88`, `main.rs:3500`, `network.rs` | hard-coded |
| `mint.115jon.site` | `house-mint` route | config |
| | `paseo-glass`, `opencode-config-wizard` | hard-coded |
| `115jon.site`, `www.115jon.site` | `109ichiki-astro` routes | config |
| | `115jon-com` `tokens.ts` | hard-coded |
| `*.115jon.site` | ralph-meet Tauri CSPs, session-inspector manifest | config |
| `noreply@115jon.site` | Kova `email.ts:9` | hard-coded |
| `abuse@115jon.site` | ralph-meet `SharedMessagePage.tsx:141` | hard-coded |
| `did:web:115jon.site:northline` | `northline/src/config.ts:10` | hard-coded identity |

## Kova consumers

| Consumer | How the auth URL is set |
|---|---|
| ralph-meet web/worker | Env (`KOVA_AUTH_URL`, `VITE_KOVA_AUTH_URL`) with a literal fallback |
| ralph-meet Tauri | CSP lists the hosts literally, so changes need a rebuild |
| ralph-meet-gpui | Hard-coded `ServiceConfig::default()`. Device-flow tests pin `*.auth.115jon.site`. |
| zeron edge | Env |
| zeron engine, iOS, Android | Hard-coded (`auth.rs:29,31`, `SignInViewController.swift`, `KovaClient.kt`) |
| float-apk-build, electrician-crew | Config with a literal fallback |
| devdoor, house-of-x, house-mint | Env with a literal fallback |
| paseo-glass, opencode-config-wizard | Hard-coded constants |
| SDK | `key.ts:17` and `device.ts:6` default to `https://auth.115jon.site`. Published versions keep the old host. |

Kova derives most of its own host behaviour from `AUTH_URL`: slug hosts, subdomain dispatch, the passkey `rpID`, the OIDC issuer and host-only cookies. The leftover literals are the CORS static origin, `device-challenges.ts`, the wrangler routes, `CDN_URL` and the email sender.

## Needs coordination, not just find-and-replace

- **Forgejo OIDC.** The issuer becomes `${new AUTH_URL}/api/auth`. Forgejo's discovery URL has to change. `sub` doesn't depend on the host, so account links survive.
- **OAuth providers.** Register `/api/auth/callback/{google,github,discord,microsoft}` on the new host before cutover. Keep the old callbacks during the overlap.
- **Passkeys.** `rpID` is the `AUTH_URL` hostname, so existing passkeys stop working on the new domain. Plan for re-enrollment.
- **Cloudflare.** `zone_name = "115jon.site"` appears in several `wrangler.toml` files. `meet.115jon.site` is attached in the dashboard, not in `wrangler.toml`.
- **CDN URLs in D1.** Absolute `CDN_URL` URLs are stored in D1, and the code compares with `startsWith(env.CDN_URL)`. Rewrite them with a D1 `REPLACE` in the same window as the `CDN_URL` change.
- **Tauri.** Both Tauri CSPs need a new release, and old installs keep the old CSP. The updater is on GitHub, so it doesn't depend on the domain.
- **Cookies.** Cookies are host-only, so users sign in again on the new hosts. Add the new origins to every registered app's allowed origins.
- **Email.** Resend domain verification plus SPF/DKIM for `115jon.com`. Links in emails already sent will break.

## Suggested order

1. Archive the duplicate Kova repos. Make the clients configurable: the SDK default, gpui, zeron, paseo and the wizard.
2. Prepare `115jon.com`:
   - DNS and TLS, including wildcard `*.auth`
   - the Resend domain
   - the provider callbacks
   - staged Forgejo settings
3. Run both domains in parallel: new routes, both sets of callbacks, and new origins on every app. Switch `AUTH_URL` last, because it changes `rpID` and the issuer.
4. Move the CDN, with the D1 URL rewrite. Then update the downstream sites.
5. Release new Tauri, mobile and native builds.
6. Cut over Forgejo and re-enroll passkeys.
7. Redirect the old hosts for a while, then remove the old callbacks, routes and zone.
