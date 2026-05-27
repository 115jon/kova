# 🛡️ Kova

Kova is a premium, open-source, edge-native authentication platform designed specifically for the Cloudflare ecosystem. Built with absolute visual craft and performance engineering, Kova enables developers to deploy zero-latency, multi-tenant authentication globally in minutes.

Unlike legacy monolithic auth platforms, Kova runs completely on the Cloudflare Edge, leveraging Cloudflare Workers, Hono, and Cloudflare D1 for real-time, global database availability with zero cold starts.

---

## ⚡ Key Features

*   **Edge-Native Architecture:** Engineered natively for Cloudflare Workers. Runs globally at the nearest edge location for lightning-fast request times.
*   **Geometric Premium UI:** Stunning glassmorphism-based dashboard and landing page built with carefully calibrated layouts, wide editorial typography, and the signature **Kova Vault Portal** brand identity.
*   **Multi-Tenant Organization Management:** Built-in support for tenant isolation, organization switching, member management, and invite flows.
*   **Robust Security Suite:** Native support for Two-Factor Authentication (2FA), Secure API Keys, dynamic webhooks, and secure audit logging.
*   **Developer SDK (`@kova/react`):** A custom, robust React SDK designed to integrate seamlessly into modern React & Next.js client applications.
*   **Dynamic Subdomains:** Automated hosted-auth routing for applications (e.g. `your-app.auth.115jon.site`).

---

## 🛠️ Tech Stack

*   **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com/) (Edge V8)
*   **Router:** [Hono](https://hono.dev/) (Lightweight, robust web framework)
*   **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQL/SQLite at the edge)
*   **Frontend Dashboard:** [React 19](https://react.dev/), [Vite](https://vite.dev/), [TanStack Router](https://tanstack.com/router)
*   **SDK Bundler:** [tsup](https://tsup.egoist.dev/) (TypeScript build tool)
*   **Package Manager:** [pnpm](https://pnpm.io/) (Monorepo workspaces)
*   **Local Dev Proxy:** [Caddy](https://caddyserver.com/) (Wildcard SSL subdomain router)

---

## 📂 Architecture & Directory Structure

```text
├── dashboard/                 # React Vite SPA (Vite + TanStack Router)
│   ├── src/
│   │   ├── components/        # Premium UI & Kova Brand Emblem Components
│   │   ├── hooks/             # Custom queries and API hooks (TanStack Query)
│   │   ├── routes/            # Dynamic SPA route hierarchy
│   │   └── styles.css         # Glassmorphism & premium dark styling tokens
│   ├── wrangler.toml          # Cloudflare Pages / Workers static asset config
├── server/                    # Hono-based Backend Worker
│   ├── src/
│   │   ├── routes/            # Modular route controllers (admin, auth, org, webhooks)
│   │   ├── migrations/        # D1 Database SQL Migrations
│   │   └── index.ts           # Worker Entrypoint
│   ├── wrangler.toml          # Worker and Database Binding Configuration
├── packages/
│   └── kova-react/            # Developer React SDK (with Client-side auth wrappers)
└── examples/
    └── sdk-demo/              # End-to-end integration demo of @kova/react SDK
```

---

## 🚀 Getting Started

### 1. Prerequisites

Before setting up Kova locally, ensure you have:
*   [Node.js](https://nodejs.org/) v20 or higher
*   [pnpm](https://pnpm.io/) (Recommended)
*   [Caddy Server](https://caddyserver.com/) (Required for local SSL wildcard subdomains)
*   [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)

### 2. Clone and Install

```bash
git clone https://github.com/115jon/kova.git
cd kova
pnpm install
```

### 3. Database Setup

Kova uses Cloudflare D1. Initialize your local D1 SQLite database and apply migrations:

```bash
# Run migrations on local dev environment
pnpm --filter server run db:migrate:local
```

### 4. Local Wildcard Domain Configuration

Kova uses subdomains for tenant isolation and OAuth bounce routines (e.g. `auth.lvh.me`). To run local dev with wildcard subdomains and secure HTTPS, we use Caddy as a reverse proxy:

1. Start Caddy with the provided `Caddyfile` at the root:
   ```bash
   caddy start --config Caddyfile
   ```
2. Caddy will dynamically map `https://auth.lvh.me` and all subdomains (such as `https://app.auth.lvh.me`) to your local development worker.

### 5. Environment Variables Setup

Create a `.dev.vars` file inside the `dashboard/` directory and configure your client keys (Google, GitHub, Discord, Resend):

```ini
# dashboard/.dev.vars
BETTER_AUTH_SECRET=change-me-to-a-random-32-char-string!!
AUTH_URL=https://auth.lvh.me
DASHBOARD_URL=https://auth.lvh.me

# OAuth Provider Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Email Dispatch
RESEND_API_KEY=your-resend-key
DASHBOARD_ADMIN_EMAIL=your-email@example.com
```

### 6. Run the Development Environment

Start the workspace in development mode:

```bash
pnpm dev
```

Open your browser and navigate to **`https://auth.lvh.me`**.

---

## 💻 Available Scripts

All workspace scripts are orchestrated from the root:

| Command | Workspace | Description |
| :--- | :--- | :--- |
| `pnpm dev` | Root | Concurrently runs Dashboard, Server Worker, and SDK Demo |
| `pnpm build` | Root | Compiles packages, bundles React SDK, and builds Vite client |
| `pnpm --filter server run db:migrate:local` | Server | Applies database migrations locally |
| `pnpm --filter server run db:migrate:prod` | Server | Deploys D1 migrations to production |
| `pnpm run deploy` | Root | Builds and deploys Workers and Pages to Cloudflare |

---

## 🚀 Production Deployment

Deploying Kova globally to Cloudflare takes just two commands:

1. Create a D1 Database via wrangler:
   ```bash
   wrangler d1 create kova-auth-db
   ```
2. Bind the new database ID to `server/wrangler.toml`.
3. Deploy the application:
   ```bash
   pnpm run deploy
   ```

All assets, routes, database integrations, and workers are immediately compiled and rolled out globally across Cloudflare's network!
