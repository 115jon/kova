---
name: kova-auth-integration
description: Integrate a React, web, desktop, or Cloudflare application with the hosted Kova authentication service and @kova/react SDK. Use for application registration, session handling, OAuth handoff, bearer-token API verification, webhooks, and authorization design.
---

# Kova Auth Integration

Use this skill when integrating another application with the Kova authentication service at `ralph-auth` and its `@kova/react` package.

Kova is a self-hosted, Better Auth-based identity service with a Clerk/Auth0-style application registry. Each consuming application gets its own credentials, origin policy, redirect policy, branding, users, sessions, and optional organizations. The application still owns its domain-specific authorization model.

## Core Model

Keep these concepts separate:

1. **Identity authentication**: Kova verifies that a person signed in and returns a Kova user and session.
2. **Application isolation**: the publishable key identifies which registered application is making the request. Kova binds app sessions and app membership to that application.
3. **Application authorization**: the consuming application decides what that authenticated user may do in its own data model.
4. **Platform administration**: a Kova platform administrator manages registered applications and global users from the Kova dashboard.

Do not use a frontend role check as the security boundary. `<Protect role="admin" />` is a rendering guard only. Every application API and WebSocket admission path must authenticate the request and enforce authorization on the server.

## Architecture

```text
Consumer web/desktop/mobile app
        |
        | @kova/react or direct HTTP
        | X-Publishable-Key: pk_...
        | Cookie or Authorization: Bearer <app session token>
        v
Kova Auth Worker
        |
        +-- Better Auth identity/session storage in D1
        +-- KV for rate limits, appearance, and short-lived transfer codes
        +-- application registry and origin/redirect allowlists
        +-- hosted per-app auth subdomains
        +-- organization membership and dynamic access control
        v
Consumer application backend
        |
        +-- verifies Kova session through /api/auth/get-session
        +-- maps user.id to local profile/membership rows
        +-- enforces app-specific roles, permissions, ownership, and resource scope
```

The Kova session is stateful. D1 is the source of truth, so bans and session revocations can take effect before the normal seven-day session lifetime ends. The encrypted cookie cache improves read performance but is not a replacement for revocation checks.

## Application Registration

Create one Kova application for each isolated consumer application or environment. Treat this as the equivalent of creating an application in Clerk or Auth0.

The application record contains:

- `id`: internal Kova application identifier.
- `publishable_key`: `pk_dev_*` or `pk_live_*`; safe to embed in frontend code.
- `secret_key`: `sk_dev_*` or `sk_live_*`; shown once and stored by Kova only as a hash. Keep it server-side.
- `allowed_origins`: exact browser origins permitted to call Kova.
- `redirect_uris`: exact browser or native callback destinations allowed after authentication.
- branding and OAuth-provider settings.
- plan and suspension state.

Use separate development and production applications. Never put a secret key in a Vite variable, mobile bundle, desktop renderer, or public repository.

### Origin and redirect rules

- Production applications must have at least one allowed origin and redirect URI.
- Production origins and ordinary redirect URIs must use HTTPS.
- Development may use local/private HTTP origins.
- Native custom-scheme redirect URIs such as `myapp://auth` are supported for redirects.
- Redirect matching is exact by origin/path, with limited query handling. Register the actual callback URL your app will send.
- Do not accept arbitrary `redirect_url` values from users and forward them to Kova. Validate them against the application configuration first.

Recommended examples:

```text
Allowed origins:
https://app.example.com
http://localhost:5173                  # development application only

Redirect URIs:
https://app.example.com/auth/callback
http://localhost:5173/auth/callback    # development application only
exampleapp://auth                       # native application
```

## React Web Integration

Install the SDK from the maintained package source:

```bash
pnpm add @kova/react better-auth
```

For the maintained GitHub monorepo package, install the package subdirectory directly with pnpm:

```bash
pnpm add "github:115jon/kova.git#v1.20.0&path:/packages/kova-react"
```

Replace `v1.20.0` with a newer release tag or commit in application lockfiles. npm Git dependencies resolve the repository root; this monorepo subdirectory form is supported by pnpm, not by npm. npm consumers need a standalone package repository or the npm registry.

Wrap the application once near the root:

```tsx
import { KovaAuthProvider } from "@kova/react";

export function AppRoot() {
  return (
    <KovaAuthProvider
      authUrl={import.meta.env.VITE_KOVA_AUTH_URL}
      publishableKey={import.meta.env.VITE_KOVA_AUTH_PUBLISHABLE_KEY}
      afterSignInUrl="/dashboard"
      afterSignUpUrl="/onboarding"
      afterSignOutUrl="/sign-in"
    >
      <App />
    </KovaAuthProvider>
  );
}
```

The publishable key encodes the auth URL in normal Kova usage, so this is also valid:

```tsx
<KovaAuthProvider publishableKey={import.meta.env.VITE_KOVA_AUTH_PUBLISHABLE_KEY}>
  <App />
</KovaAuthProvider>
```

Use the supplied components for the normal flow:

```tsx
import { Protect, SignIn, SignUp, UserButton } from "@kova/react";

export function SignInPage() {
  return <SignIn afterSignInUrl="/dashboard" signUpUrl="/sign-up" />;
}

export function SignUpPage() {
  return <SignUp afterSignUpUrl="/onboarding" signInUrl="/sign-in" />;
}

export function Navigation() {
  return <UserButton showName afterSignOutUrl="/sign-in" />;
}

export function ProtectedPage() {
  return (
    <Protect fallback={<a href="/sign-in">Sign in</a>}>
      <Dashboard />
    </Protect>
  );
}
```

Use hooks for application state:

```tsx
import { useAuth, useOrganization, useUser } from "@kova/react";

export function AccountSummary() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const { organization, membership } = useOrganization();

  if (!isLoaded) return <Loading />;
  if (!isSignedIn) return <SignInRequired />;

  return (
    <div>
      <p>{user?.name}</p>
      <p>{userId}</p>
      <p>{organization?.name ?? "Personal account"}</p>
      <p>{membership?.role ?? "member"}</p>
      <button onClick={() => void getToken()}>Refresh app token</button>
    </div>
  );
}
```

The provider automatically:

- creates a Better Auth client with `credentials: "include"`;
- sends `X-Publishable-Key` and the SDK marker header;
- fetches per-application appearance and enabled OAuth providers;
- checks the current session through `get-session`;
- obtains an app-scoped bearer session when a cross-origin cookie is not usable;
- consumes `kova_auth_code` after an OAuth redirect;
- injects `Authorization: Bearer <token>` into subsequent Kova requests;
- stores the app token under a publishable-key-specific local-storage key by default.

For custom UI, use `useSignIn()` and `useSignUp()`. Do not reimplement Kova's callback and OAuth URL validation in the browser.

## Browser Session Flows

### Email/password, magic link, or passkey

1. The SDK sends the request to Kova with `X-Publishable-Key` and credentials.
2. Kova resolves the application and checks the request origin.
3. Kova checks callback URLs for sign-in/sign-up flows.
4. Better Auth creates or validates the session.
5. Kova records `app_user` membership and stamps the session with `app_id` when the request has a publishable key.
6. The SDK observes the session and obtains an app-scoped bearer token when needed.
7. The app redirects to its local route.

### Social OAuth in an embedded app

The SDK uses a central OAuth bounce because providers should not require a new callback registration for every consumer app.

```text
App -> Kova /api/pub/apps/:pk/oauth/start
     -> provider consent
     -> Kova main-domain OAuth callback
     -> short-lived single-use transfer code
     -> app callback?kova_auth_code=...
     -> SDK exchanges code for app session token
     -> SDK removes the code from the URL and uses Bearer auth
```

The transfer code is high-entropy, publishable-key-bound, single-use, and short-lived. It is not the session token. Never log it or persist it as an application credential.

The SDK removes `kova_auth_code` from browser history immediately. Custom integrations must do the same to reduce URL/referrer leakage.

### Hosted per-application authentication

For an auth experience isolated on a Kova-managed host, use the application's generated auth slug:

```text
https://{auth_slug}.auth.example.com/sign-in
```

Hosted pages use cookies scoped to the exact application subdomain. This prevents session cookies from bleeding across sibling applications. Hosted sign-in can issue an authorization ticket, which the application backend exchanges using its secret key.

Use hosted auth when you need Kova-controlled UI/branding or a central login domain. Use the embedded SDK when the application owns the login page composition.

## Backend Authentication

The backend must validate the incoming cookie or bearer token with Kova. Do not trust a user ID, role, or signed-looking value supplied by the browser.

For a Cloudflare/TanStack Start-style application, the minimal pattern is:

```ts
export async function getKovaSession(request: Request) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");

  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  headers.set("x-publishable-key", env.KOVA_AUTH_PUBLISHABLE_KEY);

  const response = await fetch(`${env.KOVA_AUTH_URL}/api/auth/get-session`, {
    headers,
  });

  if (!response.ok) return null;
  const data = (await response.json()) as {
    user?: { id: string; email?: string | null };
    session?: { id: string; userId: string; expiresAt: string | number };
  };

  return data.user && data.session ? data : null;
}
```

For an authenticated route:

```ts
export async function requireAuth(request: Request) {
  const session = await getKovaSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}
```

For client-side calls to the consumer application's own backend, forward the token returned by `useAuth().getToken()`:

```ts
const token = await getToken();
const response = await fetch("/api/projects", {
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
});
```

Prefer a bearer header for cross-origin web APIs, desktop, mobile, and WebSocket admission. Do not put tokens in query strings except for a tightly scoped, short-lived compatibility flow; query strings leak through logs, history, analytics, and referrers.

## Authorization Design

Kova's global `user.role` is for platform-level roles such as Kova dashboard administration. It is not a substitute for the consumer application's authorization model.

Choose one or more application-level models:

### Simple application roles

Store a membership row keyed by both `app_id` and `user_id`:

```text
app_membership
  app_id
  user_id
  role: owner | admin | member
```

Every protected route should:

1. Validate the Kova session.
2. Resolve the local membership by `app_id` and `session.user.id`.
3. Check the required role or permission.
4. Check resource ownership or tenant scope.
5. Perform the query with the same scope in its `WHERE` clause.

### Organizations and dynamic RBAC

Kova's organization plugin supports organizations, members, invitations, teams, and dynamic access control. The current server defines custom resources such as `project`, `billing`, and `deploy`, with roles `owner`, `admin`, and `member`.

Use `useOrganization()` to display the active organization and membership in React, but enforce organization scope on the backend. For server checks, use Better Auth's organization access controller or an equivalent local permission function. The active organization ID comes from the authenticated session context; never accept an organization ID without verifying that the user is a member.

### Resource permissions

For fine-grained authorization, model permissions as `(resource, action)` pairs, for example:

```text
project:view
project:update
project:delete
deploy:trigger
```

A route should make its authorization requirement explicit:

```ts
const session = await requireAuth(request);
const membership = await getMembership(db, appId, session.user.id);

if (!membership || !hasPermission(membership, "project", "update")) {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
```

Return `401` when there is no valid identity. Return `403` when the identity is valid but lacks permission.

## Ralph Meet Authorization Pattern

Ralph Meet demonstrates the recommended separation:

- Kova supplies the canonical user ID and app-scoped session.
- Ralph Meet creates/updates a local `users` profile keyed by that ID.
- Server membership is stored in `server_members`.
- Server roles are stored in `roles` and `member_roles`.
- Channel-specific overrides are stored in `channel_permission_overrides`.
- API routes use `requireAuth()` before business logic.
- Server/channel permissions are calculated from role bitmasks and overrides.
- WebSocket/voice admission repeats authentication and permission checks rather than trusting the initial page load.

This lets Kova remain the identity provider while Ralph Meet owns chat-specific authorization such as `VIEW_CHANNELS`, `SEND_MESSAGES`, `MANAGE_SERVER`, and `ADMINISTRATOR`.

## Native Desktop and Mobile

Native clients cannot rely on a browser cookie in the same way as a web app. Use a browser-based sign-in and hand the resulting app token back through a registered deep link.

Recommended flow:

```text
Native app opens https://app.example.com/sign-in?redirect_url=exampleapp://auth&native_handoff=1
User signs in in the system browser
Kova redirects to exampleapp://auth?kova_auth_code=...
Native app receives the deep link
Native app exchanges the code or lets @kova/react consume it
Native app stores the app-scoped token in OS-protected storage
Native API calls send Authorization: Bearer <token>
```

For React/Tauri shells, seed the provider with `initialSessionToken` and mirror updates through `onSessionTokenChange`:

```tsx
<KovaAuthProvider
  publishableKey={publishableKey}
  initialSessionToken={secureStorageToken}
  onSessionTokenChange={(token) => {
    if (token) secureStorage.set("kova_session", token);
    else secureStorage.delete("kova_session");
  }}
>
  <App />
</KovaAuthProvider>
```

When a native API request returns `401`, refresh the app token once through the provider, retry once, then clear local auth state and require sign-in. Do not retry indefinitely.

## Sign-out

There are two relevant session types:

- Same-origin cookie session: call Kova sign-out or revoke the specific device session.
- Cross-origin app bearer session: revoke the app-scoped session through the Kova app endpoint, clear local storage/secure storage, then navigate away.

Do not clear only the frontend token while leaving a valid app session in Kova if the token can be recovered or replayed. Do not globally destroy unrelated platform sessions unless that is explicitly intended.

## Local Application Data and Webhooks

Kova's user ID is the stable identity key. The consuming application should maintain a local profile row rather than copying all identity data into every request.

Use signed Kova webhooks for asynchronous profile synchronization:

```ts
const rawBody = await request.text();
const signature = request.headers.get("x-ralph-auth-signature");

if (!signature || !verifyWebhookSignature(rawBody, signature, env.KOVA_AUTH_WEBHOOK_SECRET)) {
  return new Response("Invalid signature", { status: 400 });
}

const event = JSON.parse(rawBody) as { event: string; data: { userId?: string; id?: string } };
```

Always verify the raw request body before parsing. Make webhook handlers idempotent and tolerate duplicate delivery. Webhooks update local projections; they do not replace request-time authorization.

## Security Rules

- Publishable keys are identifiers, not secrets. Secret keys are backend-only.
- Validate `Origin` and callback/redirect URLs server-side.
- Never trust frontend route guards for access control.
- Verify the Kova session on every protected backend request or through a trusted server-side session layer.
- Scope every local query by application, tenant, organization, or resource owner as appropriate.
- Use `Authorization: Bearer` for cross-origin and native API calls.
- Avoid query-string tokens and do not log cookies, bearer tokens, transfer codes, or secret keys.
- Remove one-time auth codes from the URL immediately after receipt.
- Treat transfer codes as single-use credentials with short TTLs.
- Return `401` for unauthenticated and `403` for unauthorized requests.
- Re-check authorization at WebSocket upgrade and real-time message boundaries.
- Revoke sessions when banning or locking a user.
- Use exact production HTTPS origins and redirects.
- Keep auth-provider secrets in Worker secrets or an equivalent server-side secret store.

## Integration Checklist

```text
[ ] Create a separate Kova application for each environment.
[ ] Register every production origin and callback URI.
[ ] Store only the publishable key in frontend configuration.
[ ] Store the secret key and webhook secret in backend secrets.
[ ] Install and wrap the app with @kova/react.
[ ] Add sign-in, sign-up, sign-out, loading, and unauthorized states.
[ ] Decide whether to use embedded SDK or hosted per-app auth.
[ ] Implement server-side Kova session verification.
[ ] Forward bearer tokens from browser/native clients to application APIs.
[ ] Create local profile and membership tables keyed by Kova user ID.
[ ] Define application roles/permissions separately from Kova platform roles.
[ ] Enforce authorization in every API and real-time admission path.
[ ] Add idempotent signed webhook handling if local profile sync is needed.
[ ] Implement token refresh-once and logout behavior for native clients.
[ ] Test wrong-origin, wrong-redirect, expired-code, replayed-code, revoked-session,
    cross-application-session, missing-membership, and insufficient-permission cases.
```

## Reusable Implementation Prompt

Use the following prompt when asking another coding agent to integrate Kova into an application:

```text
Integrate this application with the hosted Kova authentication service using the maintained @kova/react package.

Requirements:

1. Inspect the existing framework, routing, server/API, desktop/mobile shell, and environment conventions before editing.
2. Add a Kova application configuration with:
   - KOVA_AUTH_URL / VITE_KOVA_AUTH_URL
   - KOVA_AUTH_PUBLISHABLE_KEY / VITE_KOVA_AUTH_PUBLISHABLE_KEY
   - server-only KOVA_AUTH_WEBHOOK_SECRET if webhooks are used
   Never expose a Kova secret key to browser or native client code.
3. Register and use KovaAuthProvider exactly once at the application root.
4. Add sign-in and sign-up routes using SignIn and SignUp, preserving the existing router's redirect state.
5. Add a loading state while Kova resolves the session and a signed-out redirect for protected routes.
6. Implement backend session verification by forwarding the request's Authorization and Cookie headers to:
   {KOVA_AUTH_URL}/api/auth/get-session
   Also send X-Publishable-Key so Kova validates the session against this application.
7. Treat the Kova user ID as the identity key. Create or upsert a local profile/membership row as needed.
8. Design application-specific authorization separately from Kova platform roles. Enforce it on the server for every API, mutation, WebSocket upgrade, and real-time message.
9. Use Authorization: Bearer <token> for cross-origin, desktop, mobile, and native calls. Do not put tokens in query strings.
10. If the app is native, support a browser sign-in callback using a registered custom-scheme redirect, persist the app token in OS-protected storage, seed initialSessionToken, and retry one 401 after refreshing the token.
11. If webhooks are needed, verify the raw body with the Kova webhook signature before parsing, make processing idempotent, and treat webhooks as cache/projection updates rather than authorization.
12. Add focused tests for unauthorized requests, wrong application/session scope, expired or replayed OAuth codes, invalid redirects, revoked sessions, missing membership, and insufficient permissions.

Do not replace Kova with another auth provider, add a second session system, trust client-side role checks, or invent a new token format without a concrete compatibility requirement.
```

## Source References

When implementation details are unclear, inspect these files in the Kova source repository:

- `packages/kova-react/src/context.tsx`: provider lifecycle, cross-origin token exchange, appearance, token persistence.
- `packages/kova-react/src/client.ts`: headers, credentials, and Better Auth plugin setup.
- `packages/kova-react/src/hooks/use-auth.ts`: token access and isolated sign-out behavior.
- `packages/kova-react/src/components/Protect.tsx`: client-only rendering guard semantics.
- `server/src/applications.ts`: application keys, allowlists, and validation rules.
- `server/src/middleware/cors.ts`: origin resolution and CORS policy.
- `server/src/routes/auth.ts`: publishable-key enforcement and session filtering.
- `server/src/routes/pub/apps.ts`: appearance, session-token bootstrap, revocation, and transfer-code exchange.
- `server/src/routes/oauth-bounce.ts`: central OAuth handoff.
- `server/src/routes/hosted-auth.ts`: hosted per-application auth and secret-key ticket exchange.
- `server/src/auth.ts`: Better Auth plugins, session lifetime, bearer auth, organizations, MFA, and hooks.
- `server/src/permissions.ts`: organization resource/action definitions and roles.

For a complete consumer example, inspect Ralph Meet's:

- `src/routes/__root.tsx`
- `src/lib/kova-auth-config.ts`
- `src/lib/kova-auth-server.ts`
- `src/lib/api-helpers.ts`
- `src/routes/sign-in.tsx`
- `src/routes/chat.tsx`
- `src/lib/desktop-auth.ts`
