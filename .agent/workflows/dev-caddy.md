---
description: start local dev with Caddy wildcard subdomain proxy
---

# Local Dev with Caddy (Wildcard Subdomain Support)

Runs Caddy as an HTTPS reverse proxy in front of the wrangler dev server,
enabling `https://*.auth.lvh.me` wildcard subdomains locally — an exact
mirror of the production `*.auth.115jon.site` setup.

**Why `lvh.me` and not `.localhost`:** Google OAuth blocks `.localhost` TLDs as authorized origins. `lvh.me` is a free public DNS service where `*.lvh.me` always resolves to `127.0.0.1` — because it's a real internet domain, Google accepts it.

| Layer | Dev | Production |
|-------|-----|-----------|
| Root domain | `https://auth.lvh.me` | `https://auth.115jon.site` |
| App subdomains | `https://{slug}.auth.lvh.me` | `https://{slug}.auth.115jon.site` |
| Backend | wrangler dev `:5174` | Cloudflare Worker |
| TLS | Caddy local CA (auto-trusted) | Cloudflare edge |
| Google OAuth | ✅ works (real domain) | ✅ works |

## Prerequisites (already done)

- Caddy installed via `scoop install caddy` ✅
- `AUTH_URL=https://auth.lvh.me` set in `server/.dev.vars` ✅
- Caddy running and CA installed into Windows trust store ✅

## Google OAuth Console setup (one-time)

In [console.cloud.google.com](https://console.cloud.google.com) → your OAuth 2.0 Client → **Authorized JavaScript origins**, add:
```
https://auth.lvh.me
```

Under **Authorized redirect URIs**, add:
```
https://auth.lvh.me/api/auth/callback/google
```

No changes needed for production — those entries stay as-is.

## Starting dev

1. Start Caddy (background daemon, from the repo root):

```powershell
caddy start --config Caddyfile
```

// turbo
2. Start or restart wrangler dev (in the server directory):

```powershell
cd server && pnpm wrangler dev
```

## Accessing the app

| URL | What it opens |
|-----|--------------|
| `https://auth.lvh.me` | Dashboard |
| `https://auth.lvh.me/sign-in` | Platform sign-in |
| `https://{auth_slug}.auth.lvh.me/sign-in` | Per-app hosted sign-in |
| `https://{auth_slug}.auth.lvh.me/api/auth/*` | Per-app Better Auth endpoints |

Find an app's `auth_slug` in the dashboard → App Detail → **Auth Domain** card.

## Stop / reload Caddy

```powershell
caddy stop                           # stop daemon
caddy reload --config Caddyfile      # hot-reload config (no restart needed)
```

## Troubleshooting

- **Port 443 in use**: `netstat -ano | findstr ":443 "` — kill the conflicting process
- **Browser cert warning**: restart the browser after first `caddy start` (CA needs to propagate)
- **wrangler not reflecting AUTH_URL**: restart wrangler dev after editing `.dev.vars`
- **lvh.me not resolving**: requires internet access (it's a public DNS record)
