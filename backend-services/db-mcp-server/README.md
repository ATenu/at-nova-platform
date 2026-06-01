# @nova/db-mcp-server

A production, spec-compliant **MCP (Model Context Protocol) resource server** that
exposes Nova's business data layer as secure, **read-only** tools over a curated set of
PII-aware views (`mcp_read.*`). It is the data plane behind the `at-sql-analyser`
agent: the agent plans and reasons, but this server is the **only component that ever
touches the database for free-form reads**, and it does so under defense-in-depth
controls.

- **Package:** `@nova/db-mcp-server` (`backend-services/db-mcp-server/`)
- **Runtime:** Node.js `>=22`; entry `node db-mcp-server/dist/main.js`, port **8002**
- **Database identity:** the dedicated `nova_mcp_readonly` PostgreSQL role (SELECT-only
  on `mcp_read`) — never the business credentials.

---

## 1. Role in the solution architecture

```text
at-sql-analyser (LangGraph agent — plans, never connects to the DB directly)
        │
        ├── MCP Streamable HTTP   POST /mcp   (per-run session)
        │       tools: describe_schema | list_views | run_select_query
        │
        └── HTTP GET /catalog  (startup Agent Card discovery; auth only, no run id)
        ▼
DB MCP server (this service)
        │  inbound : JWT (aud nova-mcp-data, azp nova-agent-sql-analyst)
        │  callback: GET {NOVA_API_INTERNAL_URL}/internal/agent-runs/{runId}/entitlement
        ▼
PostgreSQL as role nova_mcp_readonly  ──►  schema mcp_read (curated views, RLS)
```

The agent's `McpDataClient` speaks Streamable HTTP to `/mcp` with
`Authorization: Bearer …` and an `X-Nova-Run-Id` header; startup catalog discovery hits
`/catalog`. Structured (typed) reads and all writes go through the **Node tool
gateway**, not this server — this server handles **free-form SELECT** only.

---

## 2. Security model (default deny at every layer)

1. **Inbound auth** (`auth/resource-server.ts`): validates the caller's
   audience-restricted token (`aud: nova-mcp-data`, `RS256`/`ES256`, issuer, expiry)
   and pins the authorized party (`azp: nova-agent-sql-analyst`). A user token or any
   other service is rejected with `unauthenticated`.
2. **Entitlement re-enforcement** (`auth/snapshot-client.ts`): fetches the immutable
   entitlement snapshot for the run (`X-Nova-Run-Id`) from the control plane, then
   **recomputes the canonical hash** (`computeSnapshotHash` from `@nova/shared`) and
   checks expiry. A snapshot it cannot independently verify is rejected (`forbidden`),
   and upstream failures map to `upstream_unavailable`.
3. **Layered capability gate** (`auth/authorize.ts`): tools the caller is not entitled
   to are **never registered** (Layer A → `tools/list` reflects entitlement), and each
   handler re-checks the capability against the shared catalog *and* the snapshot
   allowlist (Layer B, `authorizeCapability`).
4. **Per-view authorization** (`auth/view-access.ts` + `@nova/shared` `data-views.ts`):
   every `mcp_read` view maps to the same domain permission its REST route requires.
   The advertised schema is filtered to the caller's entitled views, and **every**
   relation a `SELECT` touches is re-authorized — a join is default-deny unless every
   touched view is entitled.
5. **SQL safety** (`sql/validate-select.ts`): the query is parsed with a real parser
   (libpg_query via `pgsql-parser`) and statically validated — exactly one `SELECT`,
   allowlisted `mcp_read` relations only, no DML/DDL/utility/transaction statements, no
   `SELECT INTO`/locking clauses, no dangerous functions.
6. **Curated views** (`data/views.ts` + migration): the `mcp_read` views exclude/limit
   hard PII at the database layer. Rows from entitled views are returned **verbatim** —
   the per-view gate is the access boundary, not output masking. A column-level `pii`
   flag (currently only `customers.full_name`) is advisory metadata for the planner.
7. **Least privilege at the engine** (`data/readonly-datasource.ts`): connects as
   `nova_mcp_readonly` (SELECT only on `mcp_read`), and runs every query in a
   `READ ONLY` transaction with a `statement_timeout` and the per-session
   `nova.owner_subject` GUC that drives owner-scoped views.
8. **Limits** (`sql/limits.ts`): an outer `LIMIT` caps rows and a byte budget caps the
   serialized result, flagging truncation.
9. **PII-free audit** (`audit/audit.ts`): every decision is logged with a SQL hash,
   referenced views, row count, and duration — never raw SQL, params, or rows.

---

## 3. Tech stack & dependencies

From `package.json`:

| Dependency | Role |
|---|---|
| `@modelcontextprotocol/sdk` | `McpServer`, `StreamableHTTPServerTransport`, `isInitializeRequest` |
| `express` | HTTP host (health, catalog, MCP mount, hardening) |
| `jose` | JWT verification via remote JWKS |
| `pg` | Read-only connection pool |
| `pgsql-parser` | libpg_query parse tree (real SQL parser) |
| `zod` | Env + tool input validation (`zod/v3` subpath for SDK compat) |
| `@nova/shared` | Config, logger, `ServiceTokenClient`, `computeSnapshotHash`, capability/view helpers |

`@nova/database` is **not** a runtime import; it is a build/migration dependency that
provisions `mcp_read`, the views, and the `nova_mcp_readonly` role via the
`McpReadDataSurface1717600000000` TypeORM migration.

---

## 4. MCP protocol surface & transport

### HTTP routes (`server.ts`)

| Route | Method | Purpose |
|---|---|---|
| `/healthz` | GET | Liveness — always `{ status: 'ok' }` |
| `/readyz` | GET | Readiness — pool `SELECT 1`; 503 if unavailable |
| `/catalog` | GET | Snapshot-free schema metadata (auth only, no run id) |
| `/mcp` | POST | MCP `initialize` (new session) or continue an existing session |
| `/mcp` | GET, DELETE | Existing-session follow-ups / teardown |

Transport is `StreamableHTTPServerTransport` with `enableJsonResponse: true` and a
`randomUUID()` session id generator (server `nova-db-mcp-server` v0.1.0).

**Session model (stateful):** the first POST carrying an MCP `initialize` request (no
`mcp-session-id` header) authenticates the bearer token, requires `X-Nova-Run-Id`,
fetches + verifies the entitlement snapshot, then creates an `McpServer`, registers the
entitled tools, and binds the transport. Subsequent requests reuse the
`mcp-session-id`. **Every** HTTP request is re-authenticated at the boundary; the
session binds tool handlers to one verified snapshot for its lifetime. (Because
sessions live in an in-process map, multi-replica deployments need sticky sessions.)

### MCP methods

`initialize`, `tools/list` (entitlement-filtered = Layer A), and `tools/call` are
implemented. There are **no MCP `resources`** / `nova://schema` URIs — schema is
exposed via the `describe_schema` tool and the `GET /catalog` route.

### Tools

| Tool | Capability | Registered when |
|---|---|---|
| `describe_schema` | `data.schema.describe` | entitled **and** the caller has ≥1 readable view |
| `list_views` | `data.schema.describe` | same as above |
| `run_select_query` | `data.query.select` | entitled **and** the caller has ≥1 readable view |

Both MCP capabilities require the `create-agent-run` permission in `@nova/shared`;
actual data access is per-view via domain permissions. `run_select_query` input
(`runSelectArgs`): `sql` (string, 1–20 000 chars) and optional `params` (array of
`string | number | boolean | null`, max 64). Its success output is `{ sqlHash,
relations, rowCount, truncated, rows }` (rows verbatim). Errors return `isError: true`
with `{ error, message }`.

---

## 5. SQL safety pipeline

Order inside the `run_select_query` handler:

```text
validateSelect(sql) → findForbiddenView(relations) → clampSelectToLimit → runSelect → capResultBytes
```

### 5.1 Parser validation (`sql/validate-select.ts`)

`validateSelect` trims, rejects empty, parses with `pgsql-parser`, then walks the parse
tree. Rules:

- Exactly **one** statement, and it must be a `SelectStmt`.
- The full tree (including CTEs/subqueries) is rejected if it contains any forbidden
  node type (`InsertStmt`, `UpdateStmt`, `DeleteStmt`, `MergeStmt`, `Create*`,
  `Alter*`, `Drop*`, `TruncateStmt`, `CopyStmt`, `Grant*`, `VariableSetStmt`,
  `TransactionStmt`, `LockStmt`, `DoStmt`, `ExplainStmt`, `Execute/PrepareStmt`,
  `RefreshMatViewStmt`, `ViewStmt`, `CallStmt`, … — full list in source).
- `SELECT INTO` (`intoClause`) and locking clauses (`lockingClause`) are rejected.
- **FROM allowlist:** every `RangeVar` must resolve to `mcp_read.<allowlisted view>`
  via `isAllowedRelation`. Unqualified names, `public.*`, `pg_catalog.*`,
  `information_schema.*`, and unknown `mcp_read.*` views are rejected.
- **Forbidden functions:** `pg_sleep*`, `set_config`, `pg_read_file`, `lo_import/export`,
  `dblink*`, `pg_terminate_backend`, `pg_reload_conf`, etc. (also schema-qualified).

`SqlValidationError.reason` is one of `empty`, `unparsable`, `multiple_statements`,
`not_a_select`, `forbidden_statement`, `select_into`, `locking_clause`,
`relation_not_allowlisted`, `forbidden_function`.

### 5.2 Limits (`sql/limits.ts`)

- **Row cap** — `clampSelectToLimit` wraps the validated SQL as
  `SELECT * FROM (<sql>) AS _mcp_capped LIMIT <maxRows>` (default 500, `SQL_MAX_ROWS`,
  hard ceiling 10 000), overriding any inner LIMIT.
- **Byte cap** — `capResultBytes` measures the JSON-serialized rows and halves the row
  count from the end until within `SQL_MAX_RESULT_BYTES` (default 1 000 000), setting
  `truncated: true` when rows are dropped.
- **Timeout** — `SQL_STATEMENT_TIMEOUT_MS` (default 5000) is applied per query via
  `set_config('statement_timeout', …, true)`; PostgreSQL code `57014` maps to a safe
  `sql_rejected` error. The DB role also has `statement_timeout = '5s'` set at the
  engine level.

> There is no `sql/redact.ts` / output masking layer. Access control is per-view
> entitlement plus curated views at the database layer.

---

## 6. Read-only DB isolation

### Connection (`data/readonly-datasource.ts`)

A `pg.Pool` against `MCP_READONLY_DATABASE_URL` (`max: MCP_READONLY_POOL_MAX`, default
5; optional strict SSL; `application_name: 'nova-db-mcp-server'`). Every query
(`runSelect`):

1. `BEGIN READ ONLY`
2. `set_config('statement_timeout', …, true)` (parameterized)
3. `set_config('nova.owner_subject', …, true)` from the snapshot `ownerSubject`
4. `client.query(sql, params)` — parameterized values only
5. `COMMIT` (or `ROLLBACK` on error)

Driver errors are sanitized and never echoed (they may contain SQL/identifiers).

### Curated views (`data/views.ts` + migration)

Ten allowlisted views in schema `mcp_read`, each mapped to a domain permission:

| View | Owner-scoped | Permission |
|---|---|---|
| `customers` | no | `read-customers` |
| `products`, `sales`, `products_sold` | no | `read-sales` |
| `customer_issues` | no | `read-issues` |
| `issue_actions` | no | `read-actions` |
| `sops`, `sop_details` | no | `read-sop` |
| `users` | no | `read-users` |
| `my_assigned_actions` | **yes** | `read-actions` |

The owner-scoped `my_assigned_actions` view filters on
`current_setting('nova.owner_subject', true)` and returns **no rows when the GUC is
unset** (fail closed). The PostgreSQL role `nova_mcp_readonly` is created
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`, has `USAGE`/`SELECT` only on
`mcp_read` (no `public` access), and ships with `default_transaction_read_only = on`,
`statement_timeout = '5s'`, `idle_in_transaction_session_timeout = '10s'`,
`lock_timeout = '2s'`. Views are `WITH (security_barrier)`.

---

## 7. Audit (`audit/audit.ts`)

The `Auditor` logs an `AuditEvent` (`mcp.tool.decision`) with `runId`, `ownerSubject`,
`caller` (azp), `capability`, `decision` (`allow`/`deny`), optional `reason`,
`relations`, `rowCount`, `truncated`, `durationMs`. It **never** logs raw SQL, bound
params, or rows. Successful queries return a `sqlHash` (`sha256:` truncated) for
correlation. Deny reasons include `sql_rejected:<reason>`,
`view_forbidden:<view>:<permission>`, `forbidden`, and `unauthenticated`.

---

## 8. Configuration (`config.ts`)

All env is validated via Zod and `loadConfig` from `@nova/shared`; the process refuses
to boot on invalid config (and `main.ts` additionally requires
`MCP_DATA_CLIENT_SECRET`).

| Env var | Default | Maps to |
|---|---|---|
| `MCP_DATA_PORT` | `8002` | listen port |
| `MCP_BODY_LIMIT` | `64kb` | Express JSON limit |
| `MCP_RATE_LIMIT_WINDOW_MS` / `MCP_RATE_LIMIT_MAX` | `60000` / `120` | in-process rate limiter |
| `MCP_READONLY_DATABASE_URL` | **required** | read-only pool (must be `nova_mcp_readonly`) |
| `MCP_READONLY_DB_SSL` / `MCP_READONLY_POOL_MAX` | `false` / `5` | pool options |
| `KEYCLOAK_ISSUER_URL` | **required** | JWT issuer |
| `KEYCLOAK_JWKS_URI` | derived | JWKS URL |
| `MCP_DATA_AUDIENCE` | `nova-mcp-data` | inbound JWT audience |
| `MCP_DATA_AUTHORIZED_PARTIES` | `nova-agent-sql-analyst` | allowed `azp` (CSV) |
| `NOVA_API_INTERNAL_URL` | **required** | control plane (entitlement) base |
| `KEYCLOAK_TOKEN_URL` / `KEYCLOAK_REALM` | derived / `nova` | outbound token endpoint |
| `MCP_DATA_CLIENT_ID` / `MCP_DATA_CLIENT_SECRET` | `nova-mcp-data` / required at boot | OAuth client for the snapshot fetch |
| `ENTITLEMENT_AUDIENCE_SCOPE` | `nova-mcp-data` | snapshot fetch audience |
| `ENTITLEMENT_REQUEST_AUDIENCE_SCOPES` | `false` | request audience as scope |
| `SQL_MAX_ROWS` | `500` (max 10000) | row cap |
| `SQL_STATEMENT_TIMEOUT_MS` | `5000` | per-query timeout |
| `SQL_MAX_RESULT_BYTES` | `1000000` | result byte budget |

See `.env.example` for the full set.

---

## 9. Hardening, health & errors

- `app.disable('x-powered-by')`, JSON body limit (`MCP_BODY_LIMIT`), and an in-process
  fixed-window **rate limiter** per `req.ip` (429 `rate_limited` on excess). No CORS
  middleware (internal-only service).
- Health: `GET /healthz` (always 200) and `GET /readyz` (pool check, 503 on failure).
- Error envelope (`errors.ts`): typed `McpError` with codes `unauthenticated`,
  `forbidden`, `view_forbidden`, `invalid_request`, `sql_rejected`,
  `upstream_unavailable`, `internal`. `toSafeError()` maps anything unexpected to a
  generic internal error — never leaking stack traces or ORM/Postgres internals. HTTP
  responses are `{ error: <code>, message: <safe message> }`; MCP tool errors return
  `isError: true`.

---

## 10. Entry point & ops (`main.ts`)

Boot sequence: load config → create logger → fail if `MCP_DATA_CLIENT_SECRET` is
missing → wire `ReadOnlyDataSource`, `ResourceServer`, `ServiceTokenClient`,
`SnapshotClient` → `createMcpHttpApp(...)` → `listen`. Graceful shutdown on
`SIGTERM`/`SIGINT` closes the HTTP server then the pool.

The service is built into the shared backend image (`backend-services/Dockerfile`,
Node 22 Alpine, runs as `node`) and started in `docker-compose.yml` with
`command: ['node', 'db-mcp-server/dist/main.js']`, port 8002, healthcheck on
`/healthz`. It depends on the `mcp_read` migration having run (`db-init`) and Keycloak
being healthy.

---

## 11. Tests

Jest (`roots: ['src']`, `**/*.test.ts`):

| Test file | Coverage |
|---|---|
| `sql/validate-select.test.ts` | Accepts allowlisted SELECTs/joins/params; rejects 30+ attack vectors (DML/DDL/catalog/injection/forbidden functions/CTE insert) |
| `sql/limits.test.ts` | `clampSelectToLimit` wrapping + `capResultBytes` truncation |
| `auth/authorize.test.ts` | `authorizeCapability` allow/deny + `isEntitled` truth table |
| `auth/snapshot-client.test.ts` | Hash match, tamper, expiry, non-OK upstream |
| `auth/view-access.test.ts` | `entitledViews` mapping + join denial |
| `schema/describe-schema.test.ts` | Allowlist-only views, PII flag, owner-scoped view, entitlement filtering |
| `routes/catalog.test.ts` | 401 without/with wrong token; 200 with authorized token |

---

## 12. Development

```bash
npm run build -w @nova/db-mcp-server
npm run typecheck -w @nova/db-mcp-server
npm test -w @nova/db-mcp-server
npm run dev -w @nova/db-mcp-server   # ts-node-dev src/main.ts
```

---

## 13. Keycloak usage (validated against the code)

The DB MCP server is a service-only resource server: it **verifies** the inbound agent
token against Keycloak and **mints** one for its single outbound callback. No user
login is ever involved.

### Inbound verification (`auth/resource-server.ts`)

`ResourceServer.verify` runs on **every** `/mcp` and `/catalog` request:

- `createRemoteJWKSet(new URL(config.jwksUri))` + `jwtVerify(token, getKey, {
  issuer: KEYCLOAK_ISSUER_URL, audience: MCP_DATA_AUDIENCE (nova-mcp-data),
  algorithms: ['RS256','ES256'] })` (signature, issuer, audience, expiry/nbf via
  `jose`).
- **`azp` pin** to `MCP_DATA_AUTHORIZED_PARTIES` (default `nova-agent-sql-analyst`) —
  a user token or any other service is rejected with `unauthenticated`.
- Returns `VerifiedCaller { azp, subject }` (subject is audit-only).

### Outbound minting (entitlement callback)

`@nova/shared` `ServiceTokenClient` performs the **`client_credentials`** grant against
the derived Keycloak token endpoint (`KEYCLOAK_TOKEN_URL`, built from issuer +
`KEYCLOAK_REALM`) using `MCP_DATA_CLIENT_ID` / `MCP_DATA_CLIENT_SECRET`, scoped to
`ENTITLEMENT_AUDIENCE_SCOPE` (default `nova-mcp-data`). That token authenticates the
`GET /internal/agent-runs/:runId/entitlement` call back into `nova-api`
(`auth/snapshot-client.ts`). `main.ts` refuses to boot without `MCP_DATA_CLIENT_SECRET`.

### Configuration

`KEYCLOAK_ISSUER_URL` is **required**; `KEYCLOAK_JWKS_URI` and `KEYCLOAK_TOKEN_URL` are
derived from it (with `KEYCLOAK_REALM`) when not set. Snapshot trust comes from hash
re-verification (§2/§6), not Keycloak — Keycloak only authenticates the transport hop.
Files: `auth/resource-server.ts` (verify), `auth/snapshot-client.ts` (token use),
`config.ts` (URLs/audiences).
