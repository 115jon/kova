# Device sign-in (desktop and mobile apps)

How a native app (Ralph Meet desktop/mobile) signs a user in without deep links. It is the OAuth device flow (RFC 8628): the app shows a short code, the user approves it in a browser where they are already signed in, and the app polls until it gets a session.

## Who owns what

| Layer | What it does | Ours or upstream |
| --- | --- | --- |
| Better Auth `deviceAuthorization` plugin (1.7) | The whole RFC 8628 state machine: issuing codes, pending/approved/denied/expired, polling, `slow_down`, the one-time claim, `redeemDeviceCode`. Its `grant` option lets an app plug in rules. | Upstream |
| `src/worker/lib/device-authorization.ts` (`kovaDeviceGrant`) | Kova's rules on top of the plugin through that `grant` option: the app's publishable key is the `client_id`, each code records which app owns it, and redeeming a code mints an **app-scoped** session (`session.app_id`) instead of a platform session. | Ours, about 260 lines |
| `src/worker/routes/pub/apps.ts`, `routes/pub/device-approval.ts` | Public per-app endpoints the SDK calls (below). | Ours |
| `src/worker/routes/hosted-device*.ts`, `lib/device-host-guard.ts` | The hosted `{slug}.auth…/device` approval page, for apps without their own page, and the guard on which hosts may reach the plugin's endpoints. | Ours |
| `@115jon/kova-react`: `startDeviceSignIn`, `useDeviceApproval` and the `get/approve/deny/releaseDeviceRequest` helpers | The client side: start, poll, back off, cancel; look up, approve, deny or release a code on the app's own page. | Ours, published from `packages/kova-react` |
| Ralph Meet `src/lib/device-sign-in.ts`, `DesktopLogin.tsx`, `routes/activate.tsx`, `components/auth/DeviceActivation.tsx` | The app's screens: the code screen in the desktop/mobile shell and the `/activate` approval page on the website. | App |

Answer to "is this native to the SDK?": the flow itself is Better Auth's. The app-ownership rules, the endpoints and the SDK functions are Kova code we wrote on Better Auth's extension points. Any Kova app can use them by calling the SDK; an app writes no auth logic of its own.

## The flow

```
Desktop app                    Kova (auth.115jon.site)              Browser (meet.115jon.site/activate)
-----------                    -----------------------              ----------------------------------
startDeviceSignIn() ─────────► POST /api/pub/apps/:pk/device/start
                               plugin issues device_code + user_code
                    ◄───────── {userCode "ABCD-EFGH", verificationUri, interval 5s, expiresIn 600s}
shows the code, opens
verificationUri?code=…  ─────────────────────────────────────────────► user signs in with the embedded SDK
                                                                      (app-scoped bearer session)
                               POST …/device/lookup  {userCode} ◄──── shows device, platform, city
                               POST …/device/approve {userCode} ◄──── user taps Approve
poll every interval ─────────► POST …/device/poll
                               plugin's redeemDeviceCode (one-time)
                               insertAppScopedSession(app_id)
                    ◄───────── {status:"approved", sessionToken}
stores sessionToken, signed in
```

- **Codes:** 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), shown as `ABCD-EFGH`. They expire after 600 s; the poll interval is 5 s (`lib/device-code.ts`).
- **Polling:** the SDK waits `interval` between polls and adds 5 s on every `slow_down`. It quietly retries network and 5xx errors until the code expires, and leaves no timer behind. Ralph also calls `nudge()` when the window regains focus, so sign-in completes the moment the user comes back from the browser.
- **"Not you?":** `release` gives up the signed-in account's claim on a pending code, so another account can approve it on the same page.
- **Cancel:** `POST …/device/cancel` ends a pending code from the app.

## Endpoints

All under `/api/pub/apps/:pk/device/`, where `:pk` is the app's publishable key (`pk_live_…`; a promoted app also answers to its legacy key).

| Endpoint | Caller | Body → response |
| --- | --- | --- |
| `start` | native app | `{label,platform,hostname}` (all optional) → `{deviceCode, userCode, verificationUri(+Complete), interval, expiresIn}` |
| `poll` | native app | `{deviceCode}` → `{status:"pending"}` · 429 `{error:"slow_down"}` · `{status:"denied"}` · 400 `expired_token` / `invalid_device_code` (unknown, another app's, or already redeemed) · 403 `mfa_required` · `{status:"approved", sessionToken}` |
| `cancel` | native app | `{deviceCode}` |
| `lookup` | app's approval page | `{userCode}` → `{status, device, requester:{city,country,ip}, expiresAt}` |
| `approve` / `deny` | app's approval page | `{userCode}` → `{status}` |
| `release` | app's approval page | `{userCode}` → `{status:"released"}` |

## Security rules

- **Codes only come from `start`.** A direct call to Better Auth's `/api/auth/device/code` is refused (`authorizeRequest`).
- **No platform sessions.** The stock `/api/auth/device/token` would mint a session with no `app_id` (platform/admin reach), so it is refused for every app-owned code (`assertSessionRedemption`). Redemption only goes through `poll`, which mints a session for that one app.
- **Who may approve:**
  - only a page on one of the app's exact allowed origins (the desktop shell's own origin is never accepted);
  - only with a bearer token for an app-scoped session of the same app — cookies are ignored;
  - only for codes that app issued.
- **Rate limit:** one per-user+IP+app budget (30 per 10 minutes) shared by lookup, approve, deny and release, so codes can't be guessed through any of them. It fails closed.
- **Hosted page:** the `{slug}.auth…/device` page may only reach the plugin's verify, approve and deny steps, from its own host, with its own cookie session, and only for its own app's codes (`device-host-guard.ts`).

## Per-app configuration

- **`application.device_verification_uri`** (migration 0029): where users approve codes. Ralph Meet sets `https://meet.115jon.site/activate`, a Discord-style approval page on the app's own domain. Without it, users are sent to the hosted `{auth_slug}.auth…/device` page.
- **Allowed origins:** must include the approval page's origin.
- **`legacy_publishable_key`** (migration 0028): keeps an old key (for example, a promoted `pk_dev`) working for installed apps.
- **Tables:** migrations 0027 (device codes) and 0026 (the OIDC → `@better-auth/oauth-provider` move that came with Better Auth 1.7) hold the server-side state.

## Using it in a new app

```ts
import { startDeviceSignIn } from "@kova/react";

const signIn = startDeviceSignIn({
  authUrl: "https://auth.115jon.site",
  publishableKey: "pk_live_…",
  device: { label: "My App Desktop", platform: "windows" },
  onChange: (state) => render(state), // starting → pending {userCode, verificationUriComplete, expiresAt} → approved {sessionToken} | denied | expired | cancelled | error
});
// signIn.nudge() on window focus; signIn.cancel() on unmount; await signIn.done
```

The approval page uses `useDeviceApproval()` (lookup, approve, deny, release) inside the normal `KovaProvider`. Ralph Meet's `src/components/auth/DeviceActivation.tsx` is the reference.

## Replacing deep links

Before 3.0, the desktop app opened the browser to the sign-in page and waited for the browser to hand the session back through a registered deep link (Tauri's deep-link plugin plus a `native_handoff` step). That depended on the OS routing the custom URL scheme back to the right app, needed per-platform handlers, and sent the user to the raw auth URL. Device sign-in needs no URL handler: the session token only travels in the poll response to the app that started the flow, and approval works from any browser, including a phone.
