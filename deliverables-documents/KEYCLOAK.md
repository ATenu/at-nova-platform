# Nova Platform — Keycloak Integration

> A comprehensive reference for how Keycloak is wired into the Nova platform:
> the realm and its identities, how everything is seeded on a local
> `docker compose up`, the default credentials and their first-login behaviour,
> how running the agentic-quality harness (`test-quality/test.py`) permanently
> mutates the seeded credentials, and what must change before any production
> deployment of the Keycloak component.

---

## Table of contents

1. [Overview — what Keycloak does for Nova](#1-overview--what-keycloak-does-for-nova)
2. [The `nova` realm at a glance](#2-the-nova-realm-at-a-glance)
3. [How Keycloak is integrated module by module](#3-how-keycloak-is-integrated-module-by-module)
4. [Local seeding on `docker compose up`](#4-local-seeding-on-docker-compose-up)
5. [Seeded users, default passwords & first-login behaviour](#5-seeded-users-default-passwords--first-login-behaviour)
6. [Effect of running `test.py` on seeded credentials](#6-effect-of-running-testpy-on-seeded-credentials)
7. [Future recommendations for production](#7-future-recommendations-for-production)

---

## 1. Overview — what Keycloak does for Nova

Keycloak is the platform's **single identity provider and OAuth2/OIDC
authorization server**. Every authentication and authorization decision across
the stack ultimately traces back to a token Keycloak minted and a key Keycloak
published. Nova never invents its own session or token format.

It serves two distinct token audiences:

- **Human users** — authenticated in the browser via the OIDC Authorization Code
  flow with PKCE. The resulting access token (`aud: nova-api`) carries the
  user's realm roles, which the backend maps to a typed permission set.
- **Internal services** — the API, orchestrator, Celery worker, A2A agents, and
  MCP servers authenticate to each other with the OAuth2 `client_credentials`
  grant. Each service token is **audience-restricted** (e.g. `aud: nova-mcp-data`)
  and pinned to an **authorized party** (`azp`), so a token minted for one hop
  cannot be replayed against another.

The guiding rules are **default deny, least privilege, centralized auth, and
ID-only messaging**: tokens are validated in exactly one place per service, never
decoded ad hoc for authorization, and never logged.

### Trust model in one sentence

> The browser-facing issuer is pinned to `http://localhost:8080/realms/nova` so
> every token's `iss` validates identically in the browser and inside the Docker
> network, while the JWKS used to verify signatures is fetched over the internal
> network at `http://keycloak:8080/.../certs`.

This split (public issuer, internal JWKS) is the reason both `KEYCLOAK_ISSUER_URL`
and `KEYCLOAK_JWKS_URI` exist as separate variables on nearly every service in
`docker-compose.yml`.

---

## 2. The `nova` realm at a glance

The entire realm is declared in
[`infra/keycloak/nova-realm.dev.json`](../infra/keycloak/nova-realm.dev.json) and
baked into the Keycloak image at build time (see §4). Key realm settings:

| Setting | Value | Meaning |
| --- | --- | --- |
| `realm` | `nova` | The only realm Nova uses (the `master` realm is only used by the bootstrap admin). |
| `registrationAllowed` | `false` | Self-registration is disabled; users are provisioned by an admin/the backend. |
| `resetPasswordAllowed` | `true` | Users can trigger the forgot-password flow. |
| `loginWithEmailAllowed` | `true` | Email may be used as the login identifier. |
| `verifyEmail` | `false` | Email verification is not enforced in the dev realm. |
| `sslRequired` | `external` | TLS required for external requests (relaxed for localhost). |

### Realm roles

These five realm roles are the authoritative role vocabulary and map 1:1 to the
roles defined in code (`@nova/shared` `ROLES`):

| Realm role | Intended team |
| --- | --- |
| `admin` | Super admin / full system access |
| `sales-user` | Sales team |
| `support-operations-user` | Operations & maintenance |
| `customer-support` | Customer support |
| `ops-compliance` | Compliance team |

Roles arrive on the user's access token under `realm_access.roles`. The backend
extracts them in `auth-context.ts`, keeps only known roles, and expands them into
a typed permission set via `permissionsForRoles` in
[`packages/shared/src/rbac/permissions.ts`](../backend-services/packages/shared/src/rbac/permissions.ts).
That `ROLE_PERMISSIONS` table is the single source of truth shared by the runtime
authorization pipeline **and** the database seed, so stored data can never drift
from enforced access.

### Clients

| Client ID | Type | Flow | Purpose |
| --- | --- | --- | --- |
| `nova-frontend` | public | Auth Code + PKCE (S256) | The React SPA. Redirect/web origins pinned to `http://localhost:5173`. Has an audience mapper that injects `nova-api` so user tokens are accepted by the API. |
| `nova-api` | confidential | `client_credentials` (service account) | The Node API. Its service account holds `realm-management` roles (`manage-users`, `view-users`, `query-users`, `view-realm`) for backend-driven user provisioning. Injects a `nova-orchestrator` audience. |
| `nova-orchestrator` | confidential | `client_credentials` | The task gateway. |
| `nova-celery-worker` | confidential | `client_credentials` | The execution-plane worker. Carries audience mappers for `nova-agent-sales`, `nova-mcp-sales`, and `nova-agent-sql-analyst` so it can mint per-hop tokens. |
| `nova-agent-sql-analyst` | confidential | `client_credentials` | The SQL-analyst A2A agent. Audience mappers for `nova-mcp-data`, `nova-mcp-sales`, `nova-orchestrator`. |
| `nova-agent-sales` | confidential | `client_credentials` | A2A agent resource server (reserved). |
| `nova-mcp-data` | confidential | `client_credentials` | Read-only DB MCP resource server. |
| `nova-mcp-sales` | confidential | `client_credentials` | Sales MCP resource server (reserved). |

> **Dev secrets.** Every confidential client ships with a hard-coded dev secret
> (e.g. `nova-api-dev-secret`, `nova-mcp-data-dev-secret`). These are **local
> development credentials only** and must be rotated/replaced for any non-local
> environment (see §7).

### Audience mappers, not per-audience scopes

The dev realm injects each downstream audience via **protocol mappers on the
calling client** rather than via per-audience OAuth client scopes. This is why
services set `*_REQUEST_AUDIENCE_SCOPES=false` (e.g.
`WORKER_REQUEST_AUDIENCE_SCOPES`, `AGENT_REQUEST_AUDIENCE_SCOPES`,
`ENTITLEMENT_REQUEST_AUDIENCE_SCOPES`): forwarding the audience as an OAuth
`scope` would make Keycloak reject the request with `invalid_scope`. The
authoritative controls in the dev realm are therefore the **mapper-injected
`aud`** plus **`azp` pinning** at each resource server.

---

## 3. How Keycloak is integrated module by module

### 3.1 Frontend (React SPA)

- A single Keycloak adapter instance is created in
  [`frontend/web/src/auth/keycloak.ts`](../frontend/web/src/auth/keycloak.ts)
  from the build-time `VITE_KEYCLOAK_*` args (`url`, `realm`, `clientId`).
- `AuthProvider.tsx` initializes the session, proactively refreshes tokens
  before expiry (`TOKEN_MIN_VALIDITY_SECONDS = 30`), and exposes `can`/`is`
  helpers driven by the `/me` endpoint.
- Tokens are held **in memory** by the adapter, never written to `localStorage`
  by Nova. The browser **never** calls Keycloak Admin REST APIs.
- Per the frontend rule set, the UI may hide elements by permission for
  usability, but **the frontend is never a security boundary** — every decision
  is re-enforced server-side.

### 3.2 Backend API (Node.js / TypeScript)

Two separate verification paths, both built on `jose` and the JWKS:

- **User tokens** — `TokenVerifier`
  ([`token-verifier.ts`](../backend-services/api/src/auth/token-verifier.ts))
  validates signature, `iss`, `aud: nova-api`, and `exp/nbf`, restricting
  algorithms to `RS256`/`ES256`. `createAuthenticate` attaches a typed
  `AuthContext` to every protected request. This is the **only** place user
  tokens are verified.
- **Service tokens** — `ServiceTokenVerifier`
  ([`service-token-verifier.ts`](../backend-services/api/src/auth/service-token-verifier.ts))
  validates an audience-restricted `client_credentials` token **and** pins
  `azp` to an allowed caller (e.g. the Celery worker reaching the MCP tool
  gateway). Internal endpoints authorize from the run's entitlement snapshot,
  never from claims trusted off the wire.

**Backend-driven user provisioning.** The API authenticates as the `nova-api`
confidential client's service account and calls the Keycloak Admin REST API via
[`keycloak-admin-client.ts`](../backend-services/api/src/auth/keycloak-admin-client.ts)
(token cached until shortly before expiry; secrets never logged). The
[`KeycloakProvisioningService`](../backend-services/api/src/modules/admin/keycloak-provisioning.service.ts)
creates users, reconciles realm-role mappings against the desired Nova roles, and
can trigger an `UPDATE_PASSWORD` action email. New users are always created with
`requiredActions: ['UPDATE_PASSWORD']` and `emailVerified: false`.

**The application ↔ Keycloak link.** The
[`AddUserKeycloakIdentity` migration](../backend-services/packages/database/src/migrations/1717300000000-AddUserKeycloakIdentity.ts)
adds a nullable, uniquely-indexed `keycloak_id` column (plus an `active` flag) to
the business `users` table, so each application user can be tied to its Keycloak
identity once provisioned.

### 3.3 Python execution plane (orchestrator, worker, agents)

- **Inbound** verification mirrors the Node pattern using PyJWT + `PyJWKClient`.
  For example, the SQL-analyst agent's
  [`ResourceServer`](../agents/at-sql-analyser/src/at_sql_analyser/auth/resource_server.py)
  validates signature/issuer/`aud`/`exp` and pins `azp` to the worker — the only
  client allowed to task it (default deny on any failure).
- **Outbound**, the worker/agents mint short-lived, audience-restricted service
  tokens via the `client_credentials` grant
  ([`tokens.py`](../agents/orchestrator/src/nova_orchestrator/tokens.py)), cached
  per target audience and never logged.
- The execution plane **never sees the user's token** and **never connects to the
  business DB directly**; it re-checks authorization against the entitlement
  snapshot before each hop.

### 3.4 MCP servers

The DB MCP server (`nova-mcp-data`) validates the inbound agent token
(`aud: nova-mcp-data`, `azp: nova-agent-sql-analyst`), then re-enforces the
entitlement snapshot it fetches from the API. It connects to Postgres only as the
least-privileged `nova_mcp_readonly` role — never the business credentials.

---

## 4. Local seeding on `docker compose up`

This is the key operational detail for anyone running the stack locally.

### 4.1 The realm is baked into the image, not bind-mounted

The Keycloak service is **built from
[`infra/keycloak/Dockerfile`](../infra/keycloak/Dockerfile)**, not run from the
stock image:

```dockerfile
FROM quay.io/keycloak/keycloak:26.6
COPY nova-realm.dev.json /opt/keycloak/data/import/nova-realm.dev.json
```

The realm JSON is **copied into the image** instead of bind-mounted. This is a
deliberate workaround: on a Google Drive virtual filesystem, Docker Desktop
cannot reliably resolve a single-file bind mount and silently substitutes an
empty directory — which would make realm import fail and every `/realms/nova`
URL return 404. Copying through the build context avoids that entirely.

### 4.2 What happens at container start

The Keycloak container runs:

```bash
start-dev --import-realm
```

with these environment values (from `docker-compose.yml`):

- `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` →
  `admin` / `admin` (the **master-realm** bootstrap admin, defaults overridable
  via `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`).
- `KC_HOSTNAME: localhost`, `KC_HOSTNAME_PORT: 8080`, with strict hostname/HTTPS
  disabled — so all issued tokens carry `iss=http://localhost:8080/realms/nova`,
  matching `KEYCLOAK_ISSUER_URL` everywhere in the stack.
- `KC_HTTP_ENABLED: true`, `KC_HEALTH_ENABLED: true` (the `/health/ready` probe
  on port 9000 gates everything that `depends_on: keycloak: service_healthy`).

On first boot, `--import-realm` reads `/opt/keycloak/data/import/nova-realm.dev.json`
and creates the `nova` realm in full: all roles, all clients (with their dev
secrets and audience mappers), and all seeded users with their credentials.

### 4.3 Important: dev-mode storage is ephemeral

`start-dev` uses Keycloak's **dev-mode H2 database stored inside the container**.
There is **no named Docker volume** for Keycloak in `docker-compose.yml`.
Consequences:

- `--import-realm` only imports when the realm does not already exist. A plain
  restart of an **existing** container keeps whatever state is currently in H2
  (including any modifications — see §6).
- Because nothing is persisted to a host volume, **removing and recreating the
  Keycloak container produces a clean, freshly-imported realm**. This is the
  basis for the "rebuild to recover" guidance in §6.

### 4.4 Startup ordering

`keycloak` must report healthy before `api`, `db-mcp-server`, `at-sql-analyser`,
`orchestrator`, and `celery-worker` start (they all declare
`depends_on: keycloak: condition: service_healthy`). The `web` container is built
with `VITE_KEYCLOAK_*` args pointing at `http://localhost:8080`, realm `nova`,
client `nova-frontend`.

### 4.5 Database seed (the application-side mirror)

Separately, the one-shot `db-init` service runs migrations and the seed against
the business `nova` database. The seed
([`seed-data.ts`](../backend-services/packages/database/src/seeds/seed-data.ts))
creates the **same five users** (by email) with the **same role mapping** as the
realm, so the application's stored RBAC mirrors Keycloak's. The realm and the
seed share the exact same role names by design.

---

## 5. Seeded users, default passwords & first-login behaviour

### 5.1 Human users seeded into the realm

Five interactive users are imported from `nova-realm.dev.json`. **All five share
the same default password and the same first-login requirement:**

| Username / email | First / last name | Realm role | Default password | Temporary? |
| --- | --- | --- | --- | --- |
| `admin@test.com` | admin / admin | `admin` | `ChangeMe123!` | Yes |
| `salesman@test.com` | sales / man | `sales-user` | `ChangeMe123!` | Yes |
| `opsman@test.com` | ope / man | `support-operations-user` | `ChangeMe123!` | Yes |
| `compliance@test.com` | compliance / ops | `ops-compliance` | `ChangeMe123!` | Yes |
| `crm@test.com` | customer / support | `customer-support` | `ChangeMe123!` | Yes |

Each user is imported with:

```json
"credentials": [{ "type": "password", "value": "ChangeMe123!", "temporary": true }],
"requiredActions": ["UPDATE_PASSWORD"]
```

### 5.2 What "temporary" + `UPDATE_PASSWORD` means

Because the password is marked `temporary: true` and the user carries the
`UPDATE_PASSWORD` required action:

1. The user logs in **once** at `http://localhost:5173` with their email and
   `ChangeMe123!`.
2. Keycloak **immediately forces them to set a new password** before any token is
   issued or any application screen is reachable.
3. After the change, `ChangeMe123!` no longer works for that user; only the
   freshly chosen password does.

This models real-world onboarding: a known bootstrap secret that **must be
changed on first login**, never a long-lived shared credential.

### 5.3 Service-account "users"

The realm also imports a non-interactive entry, `service-account-nova-api`, which
is the `nova-api` client's service account granted the `realm-management` client
roles needed for backend-driven provisioning. It has no password and cannot log
in interactively.

### 5.4 The master bootstrap admin

`admin` / `admin` (in the **master** realm) is the Keycloak console superuser,
used only to administer Keycloak itself at `http://localhost:8080`. It is **not**
a Nova application user and is **not** in the `nova` realm. Change it for any
shared or non-local environment.

---

## 6. Effect of running `test.py` on seeded credentials

> **Summary:** Running the agentic-quality harness
> [`test-quality/test.py`](../test-quality/test.py) **permanently rewrites the
> seeded human-user passwords**. After it runs, the documented `ChangeMe123!`
> first-login credentials **no longer work**. To return to a clean, as-documented
> state, **rebuild the stack from scratch.**

### 6.1 Why it changes them

The seeded users are intentionally hard to script against: their password is
*temporary* and gated by an `UPDATE_PASSWORD` required action, so the OAuth
**password grant** (which the harness uses to obtain a real per-user token for
each role) would fail. To run unattended, the harness makes the seeded users
directly loggable.

### 6.2 Exactly what it does

In `provision_login()` the harness obtains a **master admin token**
(`admin`/`admin` via the `admin-cli` client) and then, for **every one of the
five seeded users**, calls `ensure_user_login_ready()`, which uses the Keycloak
Admin REST API to:

1. **`PUT /users/{id}`** — set `enabled: true`, `emailVerified: true`, and
   **clear `requiredActions` to `[]`** (removing the `UPDATE_PASSWORD` gate).
2. **`PUT /users/{id}/reset-password`** — set a **new permanent password**:

   ```text
   TestRunner123!   (temporary: false)
   ```

It also creates a dedicated public client **`nova-test-runner`** (with
`directAccessGrantsEnabled: true` and a `nova-api` audience mapper) used solely to
mint user tokens via the password grant. The real `nova-frontend` SPA client is
never modified.

### 6.3 The resulting state

After `test.py` has run at least once against a stack:

- `ChangeMe123!` (temporary) → **invalid** for all five users.
- The first-login `UPDATE_PASSWORD` flow → **gone** (required action cleared).
- The users' real password is now the hard-coded harness value `TestRunner123!`
  (permanent), and a new `nova-test-runner` client exists in the realm.

In other words, **the seeded credentials documented in §5 are consumed/altered by
the test run** and the "change on first login" experience can no longer be
demonstrated until the realm is reset.

> Note: because dev-mode Keycloak storage is **in-container H2 with no host
> volume** (§4.3), these changes live only inside the running Keycloak container.
> They survive a `restart` of that same container but are **discarded when the
> container is recreated**.

### 6.4 Recommended recovery — full rebuild for a clean environment

To restore the exact seeded state (temporary `ChangeMe123!` passwords, the
first-login `UPDATE_PASSWORD` flow, and no `nova-test-runner` client), do a
**full rebuild from a clean slate**:

```bash
# From the repository root.

# 1. Stop the stack and DELETE all volumes (also resets the seeded business
#    database, Langfuse, Redis, etc., for a truly clean environment).
docker compose down -v

# 2. Rebuild images (re-bakes the pristine realm into the Keycloak image) and
#    start fresh. --import-realm re-imports nova-realm.dev.json on first boot.
docker compose up --build
```

If you only want to reset **Keycloak** (and keep the seeded business DB and other
data), recreating just the Keycloak container is enough, since it has no
persistent volume:

```bash
docker compose up -d --build --force-recreate --no-deps keycloak
```

Either path re-imports `nova-realm.dev.json`, restoring all five users to
`ChangeMe123!` (temporary) with the `UPDATE_PASSWORD` action and removing the
`nova-test-runner` client.

> **Tip:** If you want to repeatedly demo the first-login experience, take the
> screenshots/walkthrough **before** running `test.py`, or rebuild afterwards.

---

## 7. Future recommendations for production

The realm shipped in this repo is a **development realm** (`*.dev.json`) and is
deliberately convenient, not hardened. Before any production deployment of the
Keycloak component, address the following.

### 7.1 Secrets & credentials

- **Rotate every client secret.** All confidential clients ship with predictable
  `*-dev-secret` values. Generate strong, unique secrets per environment and
  source them from a managed secret store (e.g. Azure Key Vault), never from
  `.env` or compose defaults.
- **Replace the bootstrap admin.** `admin`/`admin` (master realm) must be removed
  or replaced with a strong, uniquely-named superuser; ideally disable the static
  bootstrap admin entirely after initial setup.
- **Remove the seeded `ChangeMe123!` test users** from any production realm.
  Production users should be provisioned through the backend provisioning service
  or an identity-federation/SSO source, not baked into a realm file.

### 7.2 Run mode, persistence & hostname

- **Do not use `start-dev`.** Run Keycloak in **production mode** (`start`) with a
  real, persistent external database (e.g. PostgreSQL), not the ephemeral H2
  store. The current setup intentionally has no volume; production needs durable,
  backed-up storage.
- **Pin a real hostname over HTTPS.** Set `KC_HOSTNAME` to the production domain,
  enable `KC_HOSTNAME_STRICT`/`KC_HOSTNAME_STRICT_HTTPS`, and require TLS
  end-to-end (`sslRequired: all`). The localhost/HTTP relaxations are local-only.
- **Bake nothing environment-specific into the image.** The image-copy workaround
  for realm import exists for the Google Drive dev filesystem; in production,
  manage realm configuration via Infrastructure-as-Code / the Admin API and
  treat realm changes as reviewed, versioned migrations rather than a re-imported
  dev JSON.

### 7.3 Realm hardening

- **Enable `verifyEmail: true`** and configure a real SMTP server so the
  `UPDATE_PASSWORD` / reset-password action emails actually deliver (the backend
  already calls `execute-actions-email`).
- **Adopt true per-audience client scopes** (decision D5) instead of audience
  protocol mappers, then set the `*_REQUEST_AUDIENCE_SCOPES` flags to `true`. This
  narrows each minted service token to a single audience at the IdP, rather than
  relying on mapper-injected `aud` + `azp` pinning alone.
- **Tighten token lifetimes** and configure refresh-token rotation; review access
  token lifespans against run durations (the harness already re-mints around the
  ~5-minute access-token lifetime).
- **Add a strong password policy, brute-force detection, and account lockout** at
  the realm level.
- **Scope down the `nova-api` service account.** It currently holds broad
  `realm-management` roles for provisioning; grant only the minimum admin roles
  actually required.

### 7.4 Operational

- **High availability & backups.** Run multiple Keycloak replicas behind a load
  balancer with a shared, backed-up database; export realm config to version
  control.
- **Observability without leakage.** Forward Keycloak logs/metrics, but ensure no
  tokens, secrets, or PII are emitted (consistent with the platform's logging
  rules).
- **Key rotation.** Establish a signing-key rotation policy; `jose`/PyJWT JWKS
  clients already handle rotation transparently, so rotate keys on a schedule.
- **Separate realms per environment** (dev/staging/prod) with no shared secrets,
  and keep the dev realm file out of any production deployment path.

---

### Appendix — Keycloak-related environment variables

| Variable | Default (local) | Used by |
| --- | --- | --- |
| `KEYCLOAK_ISSUER_URL` | `http://localhost:8080/realms/nova` | All token verifiers (must match token `iss`). |
| `KEYCLOAK_JWKS_URI` | `http://keycloak:8080/realms/nova/protocol/openid-connect/certs` | Signature verification (internal network). |
| `KEYCLOAK_TOKEN_URL` | `http://keycloak:8080/realms/nova/protocol/openid-connect/token` | `client_credentials` minting (services). |
| `KEYCLOAK_AUDIENCE` | `nova-api` | API user-token verification. |
| `KEYCLOAK_REALM` | `nova` | Realm name. |
| `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` | `admin` / `admin` | Master bootstrap admin. |
| `KEYCLOAK_API_CLIENT_ID` / `KEYCLOAK_API_CLIENT_SECRET` | `nova-api` / `nova-api-dev-secret` | Backend-driven provisioning. |
| `VITE_KEYCLOAK_URL` / `VITE_KEYCLOAK_REALM` / `VITE_KEYCLOAK_CLIENT_ID` | `http://localhost:8080` / `nova` / `nova-frontend` | SPA build-time config. |

> Confidential clients additionally read `*_CLIENT_SECRET` values
> (`nova-celery-worker-dev-secret`, `nova-mcp-data-dev-secret`,
> `nova-agent-sql-analyst-dev-secret`, etc.). All are dev-only and must be rotated
> for production (§7.1).
