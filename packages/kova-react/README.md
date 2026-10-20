# @115jon/kova-react

> Drop-in React SDK for **kova-auth** — the self-hosted [Clerk](https://clerk.com) alternative built on Cloudflare Workers + Better Auth.

## Features

- 🔑 **`<SignIn />`** — email/password, magic link, passkey, OAuth social buttons, inline 2FA challenge
- ✍️ **`<SignUp />`** — email/password registration with live password-strength meter, verify-email state
- 👤 **`<UserButton />`** — avatar trigger with identity header, multi-session switcher, and sign-out
- 🏢 **`<OrgSwitcher />`** — organization picker with instant switch and personal-account fallback
- 🛡️ **`<Protect />`** — declarative route guard (`signed-in`, `signed-out`, or `role="admin"`)
- 🪝 **`useUser`, `useSession`, `useAuth`, `useOrganization`** — reactive auth state hooks
- 🎨 **Appearance API** — CSS-variable-based theming with per-element JS overrides; zero extra CSS required
- 📦 **Dual ESM + CJS** with full TypeScript declarations
- 🪶 **Zero runtime dependencies** beyond `better-auth` (peer: `react ≥ 18`)

---

## Installation

```bash
pnpm config set "@115jon:registry" https://npm.pkg.github.com
pnpm add @115jon/kova-react
```

The SDK is versioned independently from the Kova server and dashboard. Use the
latest `kova-react-vX.Y.Z` release tag when upgrading. `better-auth` is installed
as an SDK dependency. npm Git dependencies resolve the repository root, so npm
consumers should use a standalone package repository or the npm registry rather
than this monorepo subdirectory URL.

---

## Quick Start

### 1. Wrap your app

```tsx
// src/main.tsx
import { KovaAuthProvider } from "@115jon/kova-react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <KovaAuthProvider
    publishableKey="pk_live_..."         // from your app's Overview tab in the Kova dashboard
    afterSignInUrl="/dashboard"
    afterSignUpUrl="/onboarding"
    afterSignOutUrl="/sign-in"
  >
    <App />
  </KovaAuthProvider>
);
```

The provider talks to the hosted Kova service (`https://auth.115jon.site`) by
default. For a self-hosted or local Kova, also pass `authUrl`:

```tsx
<KovaAuthProvider authUrl="https://auth.lvh.me" publishableKey="pk_dev_...">
  <App />
</KovaAuthProvider>
```

### 2. Drop in auth components

```tsx
// src/pages/sign-in.tsx
import { SignIn } from "@115jon/kova-react";

export function SignInPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <SignIn afterSignInUrl="/dashboard" signUpUrl="/sign-up" />
    </div>
  );
}
```

```tsx
// src/pages/sign-up.tsx
import { SignUp } from "@115jon/kova-react";

export function SignUpPage() {
  return <SignUp afterSignUpUrl="/onboarding" signInUrl="/sign-in" />;
}
```

### 3. Add a user button to your nav

```tsx
import { UserButton } from "@115jon/kova-react";

function Navbar() {
  return (
    <nav>
      <Logo />
      <UserButton showName afterSignOutUrl="/sign-in" />
    </nav>
  );
}
```

### 4. Protect routes

```tsx
import { Protect } from "@115jon/kova-react";
import { Navigate } from "react-router-dom";

// Require sign-in
<Protect fallback={<Navigate to="/sign-in" />}>
  <Dashboard />
</Protect>

// Require admin role
<Protect role="admin" fallback={<p>Access denied</p>}>
  <AdminPanel />
</Protect>

// Redirect signed-in users away from auth pages
<Protect condition="signed-out" fallback={<Navigate to="/dashboard" />}>
  <SignIn />
</Protect>
```

---

## Hooks

| Hook | Description |
|------|-------------|
| `useAuth()` | `isLoaded`, `isSignedIn`, `userId`, `signOut` |
| `useUser()` | `user`, `isSignedIn`, `updateUser` |
| `useSession()` | Full session + user object |
| `useOrganization()` | Active org, membership, role |
| `useSignIn()` | Imperative `signIn.email / magicLink / social / passkey / totp` |
| `useSignUp()` | Imperative `signUp.email`, `verificationPending` |

```tsx
import { useUser } from "@115jon/kova-react";

function Profile() {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <Spinner />;
  if (!isSignedIn) return <p>Not signed in</p>;
  return <h1>Hello, {user.name}!</h1>;
}
```

---

## Appearance API

Customize every token globally (on the provider) or per-component:

```tsx
<KovaAuthProvider
  publishableKey="pk_live_..."
  appearance={{
    variables: {
      colorPrimary: "#7c3aed",          // Violet instead of blue
      colorBackground: "#0f0f1a",
      colorSurface: "#16162a",
      borderRadius: "12px",
    },
  }}
>
  <App />
</KovaAuthProvider>
```

Override individual elements (merged on top of provider appearance):

```tsx
<SignIn
  appearance={{
    elements: {
      card: { boxShadow: "none", border: "none" },
      formSubmitButton: { letterSpacing: "0.05em", textTransform: "uppercase" },
    },
  }}
/>
```

All elements are also addressable via the `data-ra-element` attribute in plain CSS:

```css
[data-ra-element="formSubmitButton"] {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
}
```

---

## Publishable Key

Kova issues opaque keys (`pk_dev_...` for development apps, `pk_live_...` for
production apps). A key identifies your application; it is not a secret and it
does not encode the auth server URL. Copy it from the app's Overview tab.

`encodePublishableKey` / `decodePublishableKey` remain for older self-describing
keys only. `decodePublishableKey` returns `null` for keys Kova issues.

---

## Redirect URIs

Register every URL Kova may send users back to under **Redirect URIs** in the
app's settings. A `redirect_url` that isn't registered is refused.

- `https://app.example.com/auth/callback` allows that path only (and, if you
  registered a query string, only that query).
- A bare origin with no query, `https://app.example.com/`, allows **any path**
  on that origin. Register exact paths unless that is what you want.
- Custom schemes such as `myapp://auth` match scheme, host and path.

---

## Imperative Client

For use outside React (e.g., loaders, middleware):

```ts
import { createKovaAuthClient } from "@115jon/kova-react";

export const authClient = createKovaAuthClient({
  authUrl: "https://auth.example.com",
  plugins: {
    organization: { teams: true },
    multiSession: true,
  },
});

// In a route loader:
const { data: session } = await authClient.getSession();
```

---

## Plugin Configuration

All plugins from the kova-auth server are enabled by default. Opt out selectively:

```tsx
<KovaAuthProvider
  publishableKey="pk_live_..."
  plugins={{
    admin: false,      // disable admin client
    apiKey: false,     // disable API key client
    passkey: false,    // disable WebAuthn
  }}
/>
```

---

## Architecture

```
@115jon/kova-react
├── KovaAuthProvider   — context, CSS injection, client creation
├── Components          — SignIn / SignUp / UserButton / OrgSwitcher / Protect
│   ├── ui.tsx          — shared primitives (Card, FormField, Alert, Avatar, Spinner…)
│   └── icons.tsx       — inline SVG icons (no external icon lib)
├── Hooks               — useAuth / useUser / useSession / useOrganization / useSignIn / useSignUp
├── client.ts           — createKovaAuthClient (wraps better-auth/react)
├── key.ts              — publishable key encode/decode
└── styles/inject.ts    — CSS custom-property injection
```

All components use `data-ra-element` attributes and CSS custom properties (`--ra-*`) for zero-config theming that degrades cleanly without JavaScript.
