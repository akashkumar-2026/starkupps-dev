# StarKupps Admin

Operations console for StarKupps: live order queue, menu, inventory, outlets,
staff, delivery, coupons, marketing, finance, content, support and audit logs.

A **Vite + React 19** single-page app served by a small **Express + tRPC**
gateway, with **Supabase** for Postgres, Auth, Storage and Realtime. One
deployment serves the API and the built SPA; the storefront
([starkupps-web](../starkupps-web)) is a separate app that reads the same data
through this gateway's public endpoints.

---

## Quick start

```sh
cp .env.example .env.local     # then fill in the Supabase values
npm install
npm run db:seed -- admin@starkupps.local "a-strong-passphrase" "Admin Name"
npm run dev                    # SPA on :5173, gateway on :3000
```

Open <http://localhost:5173> and sign in. If no database is configured, the dev
server answers `/api` from an in-memory mock instead — see
[Working offline](#working-offline).

## Commands

```sh
npm run verify   # lint -> typecheck -> test -> build. Run before committing.
```

| Command                                     | What it does                                               |
| ------------------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                               | Vite dev server with HMR; proxies `/api` to the gateway    |
| `npm run build`                             | `build:client` then `build:server`                         |
| `npm run preview`                           | Serve the production SPA build (see caveat below)          |
| `npm start`                                 | Run the gateway, which also serves `dist/public`           |
| `npm run serve`                             | `build` + `start` in one step                              |
| `npm run lint` / `lint:fix`                 | ESLint, including Prettier formatting                      |
| `npm run typecheck`                         | `tsc --noEmit` across `src`, `server`, `shared`, `scripts` |
| `npm test` / `test:watch` / `test:coverage` | Vitest                                                     |
| `npm run format` / `format:check`           | Prettier                                                   |
| `npm run db:seed`                           | Create or rotate the owner account                         |
| `npm run auth:unlock`                       | Clear a lockout and throttle bucket                        |
| `npm run db:migrate`                        | Apply one SQL file and record it in the ledger             |
| `npm run supabase:types`                    | Regenerate `shared/supabase.types.ts`                      |
| `npm run supabase:push`                     | Apply pending migrations via the Supabase CLI              |

`npm run preview` serves the **static** SPA only. `/api` is proxied to
`localhost:3000`, so run the gateway alongside it. To exercise the real
production topology (one process serving both), use `npm run serve`.

## Architecture

```
index.html                  the only HTML document; Vite's entry
src/                        browser app
├── main.tsx                mounts providers and renders <App/>
├── app/                    composition: App, routes, query client, workspace shell
├── api/                    everything that talks to the gateway (tRPC, CSRF, session)
├── features/               one folder per business domain; owns its UI + logic
├── components/             ui/ (shadcn), layout/, shared/, map/, auth/
├── state/                  context providers: auth, outlet, shift scope, theme
├── hooks/                  reusable React hooks
├── config/                 typed env access and the navigation model
├── types/                  shared TypeScript types
├── utils/                  pure helpers (cn, formatting, error messages)
└── styles.css              design tokens and Tailwind entry
server/                     Express + tRPC gateway
├── index.ts                HTTP entry: security headers, CORS, CSRF, routes
├── config/env.ts           the only place process.env is read
├── auth/                   tokens, sessions, cookies, rate limiting, client IP
├── db/                     Supabase/Postgres clients and the access layer
├── lib/                    tRPC wiring, request context, mailer
├── routers/                one file per domain, composed in index.ts
├── realtime.ts             Postgres change relay
└── __tests__/              Vitest suite
shared/                     code both sides import (types, permissions, constants)
dev/                        development-only tooling, never bundled
scripts/                    CLI entry points
supabase/                   migrations and local project config
```

### Layer rules

- `api`, `utils`, `types` and `config` never import React, components or
  features. They are the leaves of the graph.
- `features` own their business logic. A feature imports from `components`,
  `api`, `hooks`, `state` and `utils` — never from another feature's internals.
- `app` composes. `AdminWorkspace` maps a `View` to a lazily-imported feature,
  which is what keeps the initial download small.
- `server/routers` may not import from `server/auth` internals it does not own;
  shared access rules live in `server/db`.
- The browser never imports from `server/` except for the **type** of
  `AppRouter`, which is erased at compile time.

### How the pieces fit

- **Routing** — `wouter`. `src/app/routes.tsx` maps each URL to a `View`; the
  workspace shell resolves a `View` to a feature component. Sign-in and
  password flows load on demand; everything else sits behind the shell.
- **Server state** — tRPC over React Query. A single link in `src/main.tsx` adds
  the session cookie and the CSRF header, so no component hand-rolls `fetch`.
- **Auth** — httpOnly session cookie plus a double-submit CSRF token. The access
  token is short-lived and refreshed in the background; the browser never holds
  a token in JavaScript. Full model: [AUTH.md](./AUTH.md).
- **Realtime** — the gateway relays Supabase `postgres_changes` over SSE to
  authenticated clients, because the operational tables are RLS deny-by-default.
  Polling is the fallback if the stream drops.
- **Payments/images** — Supabase Storage, uploaded through the gateway so the
  bucket stays private.

## Environment

`.env.example` documents every variable. The rule that matters:

> Only `VITE_`-prefixed variables reach the browser, and they are inlined into
> the public bundle. **Never prefix a secret with `VITE_`.**

`src/config/env.ts` is the only module allowed to read `import.meta.env`.
`server/config/env.ts` is the only module allowed to read `process.env`, and it
refuses to start in production with a missing or weak `SESSION_SECRET`, a
missing database config, or a non-`https://` `APP_URL`.

Minimum for production: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` (48+ random bytes) and an
`APP_URL` on `https://`.

## Deployment

Deployed to Google Cloud Run (`starkupps-backend`, `asia-northeast2`). See
[DEPLOY.md](./DEPLOY.md) for deploy commands, env var management, connecting
GitHub for auto-deploy, and troubleshooting.

Build both halves, then run one process:

```sh
npm ci
npm run build
NODE_ENV=production PORT=3000 APP_URL=https://ops.starkupps.com npm start
```

- `dist/public` — hashed SPA assets. Serve with long `Cache-Control` on
  `/assets/*` and `no-cache` on `index.html`.
- `dist/index.js` — the gateway, which serves `dist/public` and the SPA
  fallback itself.

Behind a reverse proxy or CDN, set `TRUST_PROXY=true` **only** if that proxy
overwrites `X-Forwarded-For` and `X-Forwarded-Proto`. When it is false those
headers are ignored, so a client cannot spoof its own IP (defeating rate
limiting) or its scheme (downgrading a `Secure` cookie).

Set `CORS_ORIGINS` to the storefront's exact origins if it is on another host.
The gateway never sends `Access-Control-Allow-Origin: *` alongside credentials.

## Working offline

`npm run dev` with no `DATABASE_URL` serves `/api` from an in-memory mock
(`dev/mock-api.ts`) so the UI can be worked on without a database. That plugin
is `apply: "serve"`, so it never reaches a production build, and it stands down
automatically as soon as `DATABASE_URL` is set — otherwise a mocked
`/api/auth/me` would pair with a real `/api/trpc` and every query would 401.

## Tests

```sh
npm test
```

180 tests covering token signing and verification, user-enumeration cost
parity, device sessions (create/rotate/replay/revoke), rate limiting, CSRF and
cookie flags, the role-permission matrix, order pricing, selected modifiers,
inventory expiry rules and Instagram URL parsing.

`server/__tests__/auth.sessions.integration.test.ts` talks to a real database.
Set `DATABASE_URL` and `SESSION_SECRET` before running it, and expect that file
to dominate the runtime.

## Conventions

- shadcn/ui primitives live in `src/components/ui/` and are regenerated with
  `npx shadcn@latest add <component>` — edit them through that tool. App-level
  components go in `src/components/shared/` or the feature that owns them.
- Formatting is enforced by ESLint, not by hand: `npm run lint:fix`.
- `shared/supabase.types.ts` is generated. Do not edit it.
- `AUTH.md` is the source of truth for the session and CSRF model. If you change
  either, update it in the same commit.
