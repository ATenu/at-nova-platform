# @nova/db-mcp-server

A production, spec-compliant **MCP resource server** that exposes Nova's business
data layer as secure, **read-only** tools over a curated set of PII-aware views
(`mcp_read.*`). It is the data plane behind the `at-sql-analyser` agent: the agent
plans and reasons; this server is the only thing that ever touches the database
for free-form reads, and it does so under defense-in-depth controls.

## Security model (default deny at every layer)

1. **Inbound auth** (`auth/resource-server.ts`): validates the caller's
   audience-restricted token (`aud: nova-mcp-data`) and pins the authorized party
   (`azp: nova-agent-sql-analyst`). A user token or any other service is rejected.
2. **Entitlement re-enforcement** (`auth/snapshot-client.ts`): fetches the
   immutable entitlement snapshot for the run (`X-Nova-Run-Id` header) from the
   control plane, then **recomputes the canonical hash** and checks expiry. It
   never trusts a snapshot it cannot independently verify.
3. **Layered capability gate** (`auth/authorize.ts`): tools the caller is not
   entitled to are never registered (Layer A → `tools/list` reflects entitlement),
   and each handler re-checks the capability against the shared catalog (Layer B).
4. **Per-view authorization** (`tools/register-tools.ts` + `@nova/shared`
   `data-views.ts`): every `mcp_read` view maps to the SAME domain permission its
   REST route requires. The advertised schema is filtered to the caller's entitled
   views, and every relation a `SELECT` touches is re-authorized against the run's
   permission set — a join is default-deny unless EVERY touched view is entitled.
5. **SQL safety** (`sql/validate-select.ts`): the query is parsed with a real
   parser (libpg_query via `pgsql-parser`) and statically validated — exactly one
   `SELECT`, allowlisted `mcp_read` relations only, no DML/DDL/utility/transaction
   statements, no `SELECT INTO`/locking, no dangerous functions.
6. **Curated views** (`data/views.ts`): the `mcp_read` views exclude/limit hard
   PII at the database layer; rows from entitled views are returned verbatim (the
   per-view gate above is the access boundary, not output masking).
7. **Least privilege at the engine** (`data/readonly-datasource.ts`): connects as
   the `nova_mcp_readonly` role (SELECT only on `mcp_read`), runs every query in a
   `READ ONLY` transaction with a `statement_timeout` and the per-session
   `nova.owner_subject` GUC that drives owner-scoped views.
8. **Limits** (`sql/limits.ts`): an outer `LIMIT` caps rows; a byte budget caps
   the serialized result and flags truncation.
9. **PII-free audit** (`audit/audit.ts`): every decision is logged with a SQL
   hash, referenced views, row count and duration — never raw SQL, params, or rows.

## Tools

| Tool               | Capability             | Description                                   |
| ------------------ | ---------------------- | --------------------------------------------- |
| `describe_schema`  | `data.schema.describe` | Curated views with columns/types + PII flags. |
| `list_views`       | `data.schema.describe` | Names + descriptions of allowlisted views.    |
| `run_select_query` | `data.query.select`    | Validated, capped, redacted read-only SELECT. |

## Runtime

Built into the shared backend image (`backend-services/Dockerfile`) and run with
`node db-mcp-server/dist/main.js`. The endpoint is `POST /mcp` (stateless
Streamable HTTP); `GET /healthz` and `GET /readyz` are for orchestration probes.
Every MCP request must carry `Authorization: Bearer <token>` and `X-Nova-Run-Id`.

## Configuration

All configuration is environment-driven and validated at startup (`src/config.ts`);
the process refuses to boot on invalid config. See `.env.example` for the full set.
The database URL MUST use the `nova_mcp_readonly` role — never the business
credentials.

## Development

```bash
npm run build -w @nova/db-mcp-server
npm run typecheck -w @nova/db-mcp-server
npm test -w @nova/db-mcp-server
```
