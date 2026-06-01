# @nova/api

The Nova HTTP API is the platform's **control plane and business REST API**. It owns
user authentication, centralized RBAC, all business CRUD, and the **agent-run control
plane**: it creates runs, builds the immutable entitlement snapshot that authorizes
every downstream hop, enqueues work to the orchestrator by ID only, exposes the
internal tool gateway that agents call back into, and streams live run events to the
browser over SSE.

- **Package:** `@nova/api` (`backend-services/api/`)
- **Runtime:** Node.js `>=22`; entry `node api/dist/main.js`, port **3000**
- **Stack:** Express 4 + TypeORM 0.3 + `jose` + Zod, in a monorepo with `@nova/shared`
  and `@nova/database`.

---

## 1. Role in the solution architecture

The API is the only trusted, user-facing edge of the agentic stack. Everything beyond
it (orchestrator, agents, DB MCP server) is treated as a separate trust boundary that
re-verifies what the API asserts.

```text
React SPA ──(Keycloak bearer JWT)──► @nova/api  ── business CRUD ──► PostgreSQL (business DB)
                                        │
                                        │ POST /a2a/chat
                                        ├─► build EntitlementSnapshot (+ canonical hash)
                                        ├─► persist run + snapshot ──► postgres-agents
                                        ├─► store prompt in business DB (prompt_ref)
                                        └─► enqueue by ID ──► orchestrator gateway (aud: nova-orchestrator)
                                        ▲
   internal tool gateway (service JWT, azp-pinned, snapshot-re-verified):
     GET  /internal/agent-runs/:id/prompt        ◄── orchestrator worker
     GET  /internal/agent-runs/:id/entitlement   ◄── DB MCP server / agent
     POST /internal/agent-runs/:id/tool-calls    ◄── agent (capability execution)
     POST /internal/agent-runs/:id/finalize      ◄── orchestrator worker
```

It owns:

| Responsibility | Implementation |
|---|---|
| Authentication | Keycloak bearer JWT verification (`TokenVerifier`) → typed `AuthContext` |
| Centralized RBAC | Typed route-policy registry + `authorize()` middleware; permissions from `@nova/shared` |
| Business CRUD | customers, products, sales, issues, actions, SOPs, conversations |
| User / admin | JIT provisioning, Keycloak Admin sync, read-only RBAC matrix |
| Agent run creation | `POST /api/v1/a2a/chat` → snapshot → persist → enqueue |
| Agent run lifecycle | read, list, cancel, SSE event stream, trace JSON |
| Internal tool gateway | prompt fetch, capability execution, finalize, entitlement read |

It does **not** run agent reasoning, Celery, or broker dispatch.

---

## 2. Tech stack & dependencies

| Package | Role |
|---|---|
| `express` | HTTP server |
| `typeorm` (via `@nova/database`) | ORM, entities, migrations, datasources |
| `jose` | JWKS-based JWT verification |
| `zod` | Config + request validation |
| `helmet`, `cors` | Security headers, origin allowlist |
| `pino-http` | Structured request logging + correlation ids |
| `express-rate-limit` + `rate-limit-redis` + `ioredis` | Shared rate limiting |
| `@nova/shared` | RBAC, capabilities, snapshot hash, typed errors, logger, `ServiceTokenClient` |
| `@nova/database` | `AppDataSource`, `createAgentsDataSource`, entities, migrations |

Dev/test: Jest + ts-jest + supertest; `ts-node-dev` for `npm run dev`.

---

## 3. Architecture

### Layering

Every module follows the same shape:

```text
routes (*.routes.ts)
  → authenticate + authorize(policy) + validateRequest(schemas) + asyncHandler
  → controller (*.controller.ts)   — thin HTTP mapping
  → service (*.service.ts)         — business rules (AuthContext-aware)
  → repository (*.repository.ts)   — TypeORM queries
  → entity (@nova/database)        — mapped to DTOs, never returned raw
```

with `*.schema.ts` (Zod request contracts) and `*.dto.ts` (response shapes) alongside.

### Bootstrap (`main.ts`)

`loadApiConfig()` → `AppDataSource.initialize()` (business DB) →
`createAgentsDataSource().initialize()` (**optional**; if `AGENTS_DATABASE_URL` is
absent, the agent-runs surface is not mounted) → `createRedisConnection()` (optional) →
`createApp({...})` → `listen`. Graceful shutdown closes Redis and both datasources.

### App composition (`app.ts`)

Global middleware in order: `helmet()` → `cors(buildCorsOptions)` → `express.json({
limit })` → `pinoHttp` (sets `X-Request-Id`) → `createRateLimiter(...)` → feature
routers → `notFoundHandler` → `createErrorHandler`. CORS allows the headers
`Authorization`, `Content-Type`, `X-Request-Id`, `Idempotency-Key`, `Last-Event-ID`.

Mounted routers: `/health`, `/api/v1/auth` (me), `/api/v1/customers`,
`/api/v1/products`, `/api/v1/sales`, `/api/v1/issues`, `/api/v1/actions`,
`/api/v1/sops`, `/api/v1/admin`, `/api/v1/conversations`, and — when the agents DB is
configured — `/api/v1/a2a`, `/api/v1/agent-runs`, and `/internal/agent-runs`.

---

## 4. Authentication & authorization

### User authentication (`auth/authenticate.ts`, `auth/token-verifier.ts`)

`TokenVerifier.verify` uses `jose` with a remote JWKS to validate issuer, audience
(`KEYCLOAK_AUDIENCE`), expiry/nbf, and algorithms (`RS256`/`ES256` only). Failures
collapse to a generic `UnauthenticatedError`. On success, `buildAuthContext(payload)`
populates `req.auth`.

### `AuthContext` (`auth/auth-context.ts`)

Holds `subject`, `issuer`, `audience`, `email`, names, `roles`, `permissions`
(`ReadonlySet<Permission>`), and `scopes`. **Roles** come from `realm_access.roles`
(filtered to known platform roles via `toKnownRoles`); **permissions** are derived from
`permissionsForRoles(roles)` — never read directly from token claims.

### Service authentication (`auth/service-token-verifier.ts`, `auth/service-authenticate.ts`)

Internal endpoints use the same JWKS validation **plus** an `azp` (authorized party)
pin. They do not build a user `AuthContext`; internal authority comes from the
entitlement snapshot. Two instances exist: `serviceAuthenticate` (tool gateway
execution: `INTERNAL_TOOL_GATEWAY_AUDIENCE`/`AZP`) and `entitlementAuthenticate`
(narrower: `INTERNAL_ENTITLEMENT_AUDIENCE`/`AZP`).

### Centralized route policy (`auth/route-policy.ts`, `auth/authorize.ts`)

Every route declares a typed policy:

```ts
type RouteAccessPolicy =
  | { routeId: string; public: true }
  | { routeId: string; authenticated: true; audit?: boolean }
  | { routeId: string; permission: Permission; audit?: boolean };
```

`defineRoutePolicy` registers it (duplicate `routeId` throws at startup). `authorize()`
is **default deny**: `public` passes; otherwise `req.auth` is required, `authenticated`
admits any principal, and a `permission` policy requires
`rolesGrantPermission(auth.roles, policy.permission)` (else `ForbiddenError`). There
are no ad-hoc, route-level permission checks. The complete registry maps, e.g.,
`customers.* → read-customers`, `sales.create → write-sales`,
`a2a.chat → create-agent-run`, `agent-runs.cancel → cancel-agent-run`. The internal
tool-gateway routes intentionally omit `defineRoutePolicy` — authorization there is
entitlement-snapshot re-enforcement (see §5).

### RBAC source of truth (`@nova/shared`)

Roles: `sales-user`, `support-operations-user`, `admin`, `customer-support`,
`ops-compliance`. Permissions include the domain set plus agent lifecycle
(`create-agent-run`, `read-agent-run`, `cancel-agent-run`). `ROLE_PERMISSIONS` is
authoritative for both runtime auth and DB seeding. The `CAPABILITY_CATALOG` binds each
agent skill/MCP tool to AND-composed `requiredPermissions`;
`capabilitiesForPermissions` produces the snapshot allowlist.

### User profile resolution (`modules/users/current-user.ts`)

`resolveCurrentUser` matches by Keycloak `sub`, else email (linking `keycloakId` on
first match), JIT-creating the profile on first login. Authorization always uses the
**token roles**, not DB-stored roles.

---

## 5. Agent-runs control plane (deep)

### Run creation (`AgentRunService.createRun`)

`POST /api/v1/a2a/chat` (requires an `Idempotency-Key` header, returns **202** with an
`AgentRunDto`):

1. `resolveCurrentUser` → Nova profile.
2. Idempotency: return the existing run if `(ownerSubject, idempotencyKey)` matches.
3. Reuse or create the conversation; persist the user message in the business DB.
4. `buildEntitlementSnapshot({ ownerSubject, ownerUserId, roles, permissions,
   ttlSeconds })`.
5. `runs.createRun(...)` — one transaction writing the entitlement row + run row
   (`status: 'queued'`, `promptRef = nova-msg://{conversationId}/{messageId}`).
6. `enqueue(...)` via `OrchestratorClient` (best-effort — the run stays `queued` if the
   orchestrator is unreachable).

### Entitlement snapshot (`entitlement-snapshot.ts` + `@nova/shared`)

`buildEntitlementSnapshot` produces `ownerSubject`, `ownerUserId`, sorted unique
`roles`/`permissions`/`capabilityAllowlist`, `issuedAt`/`expiresAt` (epoch seconds,
TTL `AGENT_RUN_TTL_SECONDS`), and a `snapshotHash` from **`computeSnapshotHash`** —
a canonical, fixed-key-order, sorted-array `sha256:` hash that is byte-identical to the
Python worker's and the DB MCP server's recomputation. This hash is the cross-language
integrity contract for the entire execution plane.

### Orchestrator client (`orchestrator-client.ts`)

`enqueueRun` POSTs to `{ORCHESTRATOR_BASE_URL}/internal/runs` with a
`ServiceTokenClient` token (aud `nova-orchestrator`) and an **ID-only** payload
(`runId`, `requestId`, `idempotencyKey`, `actingSubject`, `entitlementSnapshotId`,
`entitlementSnapshotHash`) — no prompt, token, or secret. Mounted only when both
`ORCHESTRATOR_BASE_URL` and the Keycloak client secret are configured.

### User-facing routes (`agent-run.routes.ts`)

| Method | Path | Policy |
|---|---|---|
| POST | `/api/v1/a2a/chat` | `create-agent-run` |
| GET | `/api/v1/agent-runs?conversationId=` | `read-agent-run` |
| GET | `/api/v1/agent-runs/:runId` | `read-agent-run` |
| GET | `/api/v1/agent-runs/:runId/events` | `read-agent-run` (SSE) |
| GET | `/api/v1/agent-runs/:runId/trace` | `read-agent-run` |
| POST | `/api/v1/agent-runs/:runId/cancel` | `cancel-agent-run` |

Ownership is enforced by `requireOwnedRun`; cross-owner access returns **404** (not
403).

### SSE streaming (`AgentRunController.streamEvents`)

`text/event-stream`, resumable via `Last-Event-ID` / `afterSequence`, polling every
`SSE_POLL_INTERVAL_MS` (1000) in batches of `MAX_EVENT_BATCH` (200). It exposes
`visibility = 'user'` events by default; `detail=full` adds `internal` + `security`
events for the owner. It stops at `TERMINAL_AGENT_RUN_STATUSES` and sends keep-alive
comments.

### Internal tool gateway (`tool-gateway.routes.ts` → `ToolGatewayService`)

Mounted at `/internal/agent-runs` (service-token + snapshot re-enforcement, no route
policy):

| Method | Path | Auth |
|---|---|---|
| GET | `/:runId/prompt` | `serviceAuthenticate` |
| GET | `/:runId/entitlement` | `entitlementAuthenticate` |
| POST | `/:runId/tool-calls` | `serviceAuthenticate` |
| POST | `/:runId/finalize` | `serviceAuthenticate` |

`loadVerified(runId)` loads the run + entitlement and **recomputes the hash**,
rejecting mismatch/expiry. `executeCapability` re-checks `getCapability` +
`permissionsSatisfyCapability` against the snapshot, runs `CapabilityExecutor.execute`,
and audits to `agent_audit_log`. `finalizeRun` persists the assistant message and sets
`responseRef`. `getEntitlement` returns a PII/token-free `EntitlementView`.

### Capability executor (`capability-executor.ts`)

Thin delegation to the same permission-gated services the REST routes use, validating
input with per-capability Zod schemas. It implements 27 capability IDs (e.g.
`customers.search`, `sales.create`, `issues.create`, `actions.markCompleted`,
`sop.addVersion`) and returns a `ToolCallResult` (`capabilityId`, `summary`, `data`,
`links`) with `nova://` deep links (`AgentToolLink`).

---

## 6. Business modules

All follow routes → controller → service → repository → DTO.

| Module | Routes | Permissions |
|---|---|---|
| `customers` | `GET /`, `GET /:id` | `read-customers` |
| `products` | `GET /` | `read-sales` |
| `sales` | `GET /`, `POST /`, `GET /:id` | `read-sales`, `write-sales` (money via `lib/money.ts`) |
| `issues` | `GET /`, `POST /`, `GET /:id`, `PATCH /:id` | `read-issues`, `create-issues`, `write-issues` |
| `actions` | `GET /`, `PATCH /:id`, `POST /:id/comments` | `read-actions`, `write-actions` |
| `sops` | `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `POST /:id/versions` | `read-sop`, `write-sop` |
| `chat` (conversations) | `GET /`, `POST /`, `GET /:id` | `authenticated` (ownership in service) |
| `me` | `GET /api/v1/auth/me` | authenticated |
| `admin` | users CRUD + `PUT /:id/roles` + `POST /:id/sync-keycloak`; read-only RBAC matrix (`/roles`, `/permissions`, `/role-permissions`) | `read/write-users`, `read-permissions` |
| `health` | `GET /health/live` (public), `GET /health/ready` (DB required) | — |

Admin user provisioning uses `KeycloakProvisioningService` + `KeycloakAdminClient`
(enabled when `KEYCLOAK_API_CLIENT_SECRET` is set); the browser never calls the
Keycloak Admin API. The RBAC matrix reflects `@nova/shared` `ROLE_PERMISSIONS` (runtime
grants are not editable via the API).

---

## 7. Validation & error handling

- **Validation** (`http/validate.ts`): `validateRequest({ body?, query?, params? })`
  parses with Zod at the route boundary; failures become a `ValidationError` with
  formatted issue paths.
- **Errors** (`@nova/shared` `app-error.ts` + `http/error-handler.ts`): typed errors
  (`ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`,
  `ConflictError`, `InternalError`) map to status codes and a single
  `application/problem+json` envelope (`type`, `title`, `status`, `code`,
  `correlationId`, optional `detail`). No stack traces or ORM internals are leaked.
- **Rate limiting** (`http/rate-limit.ts`): sliding window (`API_RATE_LIMIT_*`),
  Redis-backed when `REDIS_CACHE_URL` is set, with a `FailOpenStore` (default) so a
  Redis outage does not 5xx traffic; an in-memory fallback warns it is not
  multi-replica safe. Production requires `REDIS_CACHE_URL`.

---

## 8. Configuration (`config.ts`)

All env is read once via `loadConfig(apiEnvSchema)` from `@nova/shared`. Selected
variables:

| Env var | Default | Purpose |
|---|---|---|
| `API_PORT` | `3000` | listen port |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | CSV origin allowlist |
| `API_BODY_LIMIT` | `100kb` | JSON body max |
| `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` | `60000` / `120` | rate limit |
| `KEYCLOAK_ISSUER_URL` | **required** | JWT issuer |
| `KEYCLOAK_AUDIENCE` | **required** | expected audience (CSV) |
| `KEYCLOAK_JWKS_URI` / `KEYCLOAK_REALM` | derived / `nova` | JWKS / realm |
| `KEYCLOAK_API_CLIENT_ID` / `KEYCLOAK_API_CLIENT_SECRET` | `nova-api` / optional | admin + orchestrator tokens |
| `AGENTS_DATABASE_URL` / `AGENTS_DB_SSL` | optional | agents DB (disables agent surface if absent) |
| `ORCHESTRATOR_BASE_URL` / `ORCHESTRATOR_AUDIENCE` | optional / `nova-orchestrator` | enqueue target |
| `AGENT_RUN_TTL_SECONDS` | `7200` | snapshot TTL |
| `INTERNAL_TOOL_GATEWAY_AUDIENCE` / `_AZP` | `nova-mcp-sales` / `nova-celery-worker,nova-agent-sql-analyst` | tool gateway auth |
| `INTERNAL_ENTITLEMENT_AUDIENCE` / `_AZP` | `nova-mcp-data` / `nova-agent-sql-analyst,nova-mcp-data` | entitlement endpoint auth |
| `REDIS_CACHE_URL` / `REDIS_RATE_LIMIT_FAIL_OPEN` | optional (required in prod) / `true` | cache + rate limit |

The business DB connection is configured via `@nova/database` (`DATABASE_URL` or
`POSTGRES_*`), not here.

---

## 9. Database access

Two PostgreSQL datasources, both `synchronize: false` with explicit migration class
arrays:

| DataSource | Factory | Env | Entities | Migrations table |
|---|---|---|---|---|
| Business | `AppDataSource` | `DATABASE_URL`/`POSTGRES_*` | 17 entities | `nova_migrations` |
| Agents | `createAgentsDataSource()` | `AGENTS_DATABASE_URL` | `AgentRun`, `AgentRunEntitlement`, `AgentRunEvent`, `WebhookAuthConfig`, `WebhookDelivery` | `nova_agents_migrations` |

Cross-DB links are logical only (no FK): `AgentRun.conversationId` → business
`conversations.id`; `promptRef`/`responseRef` use `nova-msg://{conversationId}/{messageId}`.

---

## 10. Tests

Jest tests under `src/` cover the security- and business-critical paths: `authorize`
(public/authenticated/permission matrix), `auth-context` claim mapping, rate-limit
fail-open, health readiness, entitlement snapshot determinism, `AgentRunService.createRun`
(ownership default-deny, conversation-scoped list), tool-gateway snapshot verification +
capability deny/allow + finalize, capability executor, customer/sale services, Keycloak
provisioning, and money helpers.

---

## 11. File map (selected)

| Path | Description |
|---|---|
| `src/main.ts` / `src/app.ts` / `src/config.ts` | Bootstrap, app factory, typed config |
| `src/auth/authenticate.ts` / `authorize.ts` / `route-policy.ts` | AuthN, centralized AuthZ, policy registry |
| `src/auth/token-verifier.ts` / `service-token-verifier.ts` | User + service JWT verification |
| `src/auth/auth-context.ts` / `keycloak-admin-client.ts` | `AuthContext`, Admin REST client |
| `src/http/error-handler.ts` / `validate.ts` / `rate-limit.ts` | Error envelope, Zod middleware, rate limiter |
| `src/modules/agent-runs/agent-run.service.ts` | `createRun`, events, trace, cancel |
| `src/modules/agent-runs/entitlement-snapshot.ts` | `buildEntitlementSnapshot` |
| `src/modules/agent-runs/orchestrator-client.ts` | `enqueueRun` |
| `src/modules/agent-runs/tool-gateway.service.ts` | Snapshot re-enforcement + capability execution |
| `src/modules/agent-runs/capability-executor.ts` | Capability → business service delegation |
| `src/modules/agent-runs/agent-links.ts` | `nova://` deep link helpers |
| `src/modules/{customers,products,sales,issues,actions,sops,chat,me,users,admin,health}/` | Business modules |
| `src/lib/money.ts` | String-safe money/decimal helpers |

---

## 12. Development

```bash
npm run build -w @nova/api
npm run typecheck -w @nova/api
npm test -w @nova/api
npm run dev -w @nova/api    # ts-node-dev src/main.ts
```

In Docker the API is the default `CMD` of the shared backend image
(`backend-services/Dockerfile`) and is started by the root `docker-compose.yml` after
`db-init` completes.

---

## 13. Keycloak usage (validated against the code)

Keycloak is the platform's identity provider, and the API is the component with the
**richest** Keycloak integration: it verifies user *and* service tokens, mints service
tokens, and drives user provisioning through the Keycloak Admin REST API.

### 1. Inbound user token verification (`auth/token-verifier.ts`)

`TokenVerifier` is the **only** place a JWT is verified for authorization. It uses
`createRemoteJWKSet(new URL(config.jwksUri))` (cached, rotation-handled by `jose`) and
`jwtVerify(token, getKey, { issuer: KEYCLOAK_ISSUER_URL, audience: KEYCLOAK_AUDIENCE,
algorithms: ['RS256','ES256'] })`. Failures collapse to a generic
`UnauthenticatedError` (no leak of the reason). `buildAuthContext` then reads roles
from `realm_access.roles`; permissions are derived from those roles, never trusted from
token claims.

### 2. Inbound service token verification (`auth/service-token-verifier.ts`)

Internal endpoints (`/internal/agent-runs/*`) use the same JWKS/issuer validation
**plus an `azp` pin**. Two configured guards: `serviceAuthenticate`
(`INTERNAL_TOOL_GATEWAY_AUDIENCE` / `_AZP`) for tool-call execution and
`entitlementAuthenticate` (`INTERNAL_ENTITLEMENT_AUDIENCE` / `_AZP`) for the
entitlement endpoint.

### 3. Outbound service token minting

`@nova/shared` `ServiceTokenClient` performs the **`client_credentials`** grant against
the derived token endpoint using `KEYCLOAK_API_CLIENT_ID` / `KEYCLOAK_API_CLIENT_SECRET`
to obtain a `nova-orchestrator`-audience token for the
`POST /internal/runs` enqueue (`orchestrator-client.ts`).

### 4. Keycloak Admin REST (`auth/keycloak-admin-client.ts`)

For backend-driven user lifecycle (the browser never calls the Admin API),
`KeycloakAdminClient` authenticates via `client_credentials`
(`{baseUrl}/realms/{realm}/protocol/openid-connect/token`) and calls
`{baseUrl}/admin/realms/{realm}/...` to: find/create users
(with `requiredActions: ['UPDATE_PASSWORD']`), enable/disable, update profiles, read
and add/remove **realm role mappings**, and send `UPDATE_PASSWORD` action emails. It is
wired through `KeycloakProvisioningService` / `AdminUserService` and only enabled when
`KEYCLOAK_API_CLIENT_SECRET` is configured. Tokens/secrets are never logged.

### Configuration

`KEYCLOAK_ISSUER_URL` and `KEYCLOAK_AUDIENCE` are **required**; `KEYCLOAK_JWKS_URI`,
`KEYCLOAK_REALM`, `KEYCLOAK_ADMIN_BASE_URL`, and the orchestrator token URL are derived
from the issuer when not set. Files: `auth/token-verifier.ts`,
`auth/service-token-verifier.ts`, `auth/service-authenticate.ts`,
`auth/keycloak-admin-client.ts`, `modules/admin/keycloak-provisioning.service.ts`,
`config.ts`.
