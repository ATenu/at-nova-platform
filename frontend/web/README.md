# @nova/web

The Nova web frontend: a React + TypeScript single-page app for A2A agent chat,
RBAC admin, customers, products, sales, customer issues, action queues, and SOP
workflows. Built with Vite, React Router, TanStack Query, React Hook Form, Zod,
and the Keycloak JS adapter.

This app is a standalone npm project (its own `package.json`, lockfile,
`tsconfig`, ESLint, and build tooling). It never imports server-only code.

## Security model

- **The frontend is never an authorization authority.** It hides UI by
  permission for usability only; the API (`backend-services/api`) enforces all
  access on every request.
- Authentication is owned by Keycloak. The app obtains a bearer token via the
  Keycloak JS adapter and attaches it to every API call through a single typed
  HTTP client. It never decodes tokens for authorization, and never calls
  Keycloak Admin REST APIs from the browser.
- The current user's roles/permissions come from the backend
  (`GET /auth/me`) — the source of truth for what the UI may surface.
- No secrets in the bundle. Only `VITE_`-prefixed values are exposed, and those
  are public client config only.

## Scripts

```bash
npm install        # install dependencies (uses the committed package-lock.json)
npm run dev        # Vite dev server on http://localhost:5173
npm run typecheck  # tsc, no emit
npm run lint       # eslint
npm test           # vitest (unit + integration with MSW)
npm run build      # type-check then production build to dist/
npm run preview    # preview the production build locally
```

## Environment

Copy `.env.example` to `.env` and adjust:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the Nova API (e.g. `http://localhost:3000/api/v1`) |
| `VITE_KEYCLOAK_URL` | Keycloak base URL (e.g. `http://localhost:8080`) |
| `VITE_KEYCLOAK_REALM` | Realm name (`nova`) |
| `VITE_KEYCLOAK_CLIENT_ID` | Public client id (`nova-frontend`) |
| `VITE_APP_NAME` | Display name shown in the UI |
| `VITE_USE_MOCKS` | `true` to run fully offline (mock API + mock auth); MUST be `false`/unset anywhere deployed |

### Mock mode (no backend, no Keycloak)

Set `VITE_USE_MOCKS=true` and run `npm run dev`. The app boots an in-browser API
([MSW](https://mswjs.io/)) seeded to mirror the backend, plus a mock auth session
with a login screen to pick a seeded role. This is the fastest way to explore the
UI and is what the test suite uses. The mock worker is dynamically imported, so
it is never loaded in a production build.

## Local Keycloak + seeded users

The repository's root `docker compose up --build` starts Postgres, the API,
Keycloak (with the `nova` realm imported), and this web app. Keycloak is exposed
on http://localhost:8080 (admin console: `admin` / `admin` — local only).

The realm import (`infra/keycloak/nova-realm.dev.json`) seeds these users, each
with a **temporary** password `ChangeMe123!` (you are forced to change it on
first login). These mirror the database seed roles:

| Email | Role |
|---|---|
| `admin@test.com` | `admin` |
| `salesman@test.com` | `sales-user` |
| `opsman@test.com` | `support-operations-user` |
| `compliance@test.com` | `ops-compliance` |
| `crm@test.com` | `customer-support` |

Temporary dev credentials are never stored in the application database. Do not
use this password strategy outside local development.

## Architecture

```text
src/
  app/         App root, providers, router
  auth/        Keycloak adapter, AuthProvider, permissions mirror, route guards
  api/         Single typed HTTP client, query client, per-domain API modules
  components/  Reusable UI primitives and the app shell (sidebar, topbar, …)
  features/    Screens by domain (dashboard, chat, admin, sales, issues, …)
  lib/         Env, money (string-safe), dates, error normalization, nova:// links
  mocks/       MSW handlers + fixtures (dev/test only)
  test/        Vitest setup and render helpers
```

## Docker

Built and served as static assets by nginx via `frontend/web/Dockerfile`
(published on host port `5173` to match the realm redirect URIs). `VITE_*`
values are inlined at build time; override them with build args / `.env` at the
repo root. See the root `docker-compose.yml` `web` service.
