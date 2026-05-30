# Nova Platform

A production-grade TypeScript monorepo for the Nova application: a secure
Node.js HTTP API over PostgreSQL (TypeORM), a shared data layer, and a
scaffolded MCP **data-surfacer** for A2A agents.

## Architecture

The codebase is layered and dependency-inward (transport → application →
domain → infrastructure), with cross-cutting concerns centralized in shared
packages.

The repository is polyglot. Each top-level service category owns its own
toolchain and configuration; only the shared environment file and the
orchestration live at the root.

```text
backend-services/        Self-contained Node/TS npm workspace (own package.json, lockfile,
  package.json             tsconfig.base.json, eslint, prettier, Dockerfile)
  packages/
    shared/      @nova/shared          Typed RBAC, errors, structured logging, config loading
    database/    @nova/database        TypeORM entities, migrations, seeds, DataSource (single source of truth)
  api/           @nova/api             Express API: auth pipeline, route-policy RBAC, feature modules
  db-mcp-server/ @nova/db-mcp-server   Read-only schema data-surfacer / DB MCP server for agents (scaffold)
frontend/                React + TS web app(s) — own npm config
  web/         @nova/web             Vite SPA: A2A chat, RBAC admin, sales, issues, actions, SOPs
mcp-servers/             Additional standalone MCP servers — own config (future)
agents/                  Python A2A LangGraph agents — own Python config (future)
infra/keycloak/          Local Keycloak realm import (`nova-realm.dev.json`)
docker-compose.yml       Single-command orchestration; run `docker compose up` from the root
.env / .env.example      One shared environment file for all services
```

Both `@nova/api` and `@nova/db-mcp-server` consume the same `@nova/database`
layer, so the schema is never duplicated. RBAC permissions live once in
`@nova/shared` and are used by **both** runtime authorization and the database
seed, so stored grants can never drift from enforced access.

All npm/TypeScript tooling for the backend lives inside `backend-services/`, so
run npm commands from there. The frontend and agents carry their own
configuration and are built independently.

## Prerequisites

- Node.js 22+
- Docker (for the one-command stack)

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, waits until it is healthy, runs migrations, seeds the
database idempotently, brings up Keycloak with the `nova` realm imported, starts
the API, and serves the web frontend.

- Web app: http://localhost:5173
- API: http://localhost:3000 (liveness `GET /health/live`, readiness `GET /health/ready`)
- Keycloak: http://localhost:8080 (admin console `admin` / `admin`, local only)

### API surface (all protected, under `/api/v1`)

Every route runs `authenticate → authorize(policy) → validate → controller`.

| Area | Routes | Permission |
|---|---|---|
| Current user | `GET /auth/me` | any authenticated |
| Customers | `GET /customers`, `GET /customers/:id` | `read-customers` |
| Products | `GET /products` | `read-sales` |
| Sales | `GET /sales`, `GET /sales/:id` · `POST /sales` | `read-sales` · `write-sales` |
| Issues | `GET /issues`, `GET /issues/:id` · `POST /issues` · `PATCH /issues/:id` | `read-issues` · `create-issues` · `write-issues` |
| Actions | `GET /actions` · `PATCH /actions/:id`, `POST /actions/:id/comments` | `read-actions` · `write-actions` |
| SOPs | `GET /sops`, `GET /sops/:id` · `POST /sops`, `PATCH /sops/:id`, `POST /sops/:id/versions` | `read-sop` · `write-sop` |
| Admin users | `GET/POST /admin/users`, `GET/PATCH /admin/users/:id`, `PUT /admin/users/:id/roles`, `POST /admin/users/:id/sync-keycloak` | `read-users` · `write-users` |
| RBAC (read-only) | `GET /admin/roles`, `GET /admin/permissions`, `GET /admin/role-permissions` | `read-permissions` |
| Agent chat | `GET/POST /conversations`, `GET /conversations/:id`, `POST /a2a/chat` | any authenticated |

Sales totals are computed authoritatively on the server (decimal-safe; client
totals are never trusted). The role → permission matrix is read-only because the
enforced grants live in `@nova/shared`; a runtime edit could never change policy.

### Seeded test users

The realm import seeds five users mirroring the database seed roles, each with a
temporary password `ChangeMe123!` (changed on first login). Sign in at the web
app and you are redirected to Keycloak:

| Email | Role |
|---|---|
| `admin@test.com` | `admin` |
| `salesman@test.com` | `sales-user` |
| `opsman@test.com` | `support-operations-user` |
| `compliance@test.com` | `ops-compliance` |
| `crm@test.com` | `customer-support` |

Temporary dev credentials are never copied into the application database.

## Frontend

The web app lives in `frontend/web` (`@nova/web`) and has its own toolchain. For
local UI work without the backend or Keycloak, run it in mock mode:

```bash
cd frontend/web
npm install
npm run dev            # http://localhost:5173 (VITE_USE_MOCKS=true serves an in-browser mock API)
```

See `frontend/web/README.md` for environment variables, the security model, and
the seeded mock roles.

## Local development

Backend npm commands run from the `backend-services/` workspace:

```bash
cd backend-services
npm install
npm run build:packages      # build @nova/shared and @nova/database (consumed by the apps)
npm run dev:api             # start the API with reload (needs a reachable Postgres + .env)
```

Point the API at a database via `DATABASE_URL` (or the individual `POSTGRES_*`
variables) in the root `.env`.

## Database

From `backend-services/`:

```bash
npm run db:migrate          # run migrations (dev, ts-node)
npm run db:seed             # idempotent seed (dev, ts-node)
npm run db:init             # migrate + seed
SEED_RESET=true npm run db:seed   # wipe & reseed (ignored in production)
```

- Explicit migrations only; `synchronize` is never enabled.
- snake_case columns, camelCase properties; money stored as `numeric`.
- Seeds are idempotent (deterministic UUIDs, upserts) and print row counts.

## Authentication & authorization

- Keycloak bearer tokens validated centrally with JWKS (`jose`): issuer,
  audience, expiry, and signature; `alg: none` is rejected.
- Every protected route is composed `authenticate → authorize(policy) →
validate → controller`, with a typed `RouteAccessPolicy` registry.
- Default deny: routes without a granted permission are rejected; public routes
  are explicit.
- The frontend is never the authority — the backend enforces all access. The
  in-browser mock mode is dev-only and cannot run in a production build; the API
  always validates real Keycloak tokens.
- User management is backend-driven: the API provisions and reconciles Keycloak
  users + realm-role mappings via the Admin REST API, authenticating as the
  `nova-api` confidential client's service account (`client_credentials`). The
  browser never calls Keycloak Admin endpoints. Provisioning is enabled only
  when `KEYCLOAK_API_CLIENT_SECRET` is set; otherwise the API still manages local
  profiles and reports an un-provisioned sync status.

## MCP data-surfacer

See `backend-services/db-mcp-server/README.md`. The read-only `describeSchema` core already
surfaces tables, columns, enums, relations, and indexes from the shared model
(from `backend-services/`):

```bash
npm run surface-schema -w @nova/db-mcp-server
```

## Quality gates

From `backend-services/`:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Validate the engineering Skill library:

```bash
python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py
```
