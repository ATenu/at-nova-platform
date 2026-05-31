# SQL Analyst Agent + DB MCP Server — Production Implementation Plan

Status: design locked for implementation. Companion to `celeryWorkerPlan.md`
(the orchestration plane this extends).

Applied standards: `.cursor/skills/secure-production-engineering/SKILL.md` and its
resources `security-by-design.md`, `python-langgraph-agents.md`,
`auth-keycloak-rbac.md`, `backend-node-typeorm.md`,
`database-typeorm-data-access.md`, `observability-langfuse.md`,
`testing-quality-gates.md`. This plan is self-reviewed against
`code-review-checklist.md`.

This plan covers three deliverables:

1. **DB MCP server** — turn `backend-services/db-mcp-server` from a scaffold into
   a production, spec-compliant MCP resource server exposing the data layer as
   secure, read-only tools.
2. **`agents/at-sql-analyser`** — a new Python A2A LangGraph agent that uses the
   DB MCP server (for reads) and the typed capability tools (for writes) in a
   bounded agentic harness to surface the full data layer and act on behalf of
   the user.
3. **Orchestrator integration + steering** — register the agent and its skills,
   add an agent-selection ("steering search") layer, and make `at-sql-analyser`
   the **default fallback** when no better-targeted agent matches.

Non-negotiables (from `AGENTS.md` + the skill) hold throughout: secure by
design, default deny, least privilege, defense in depth, centralized RBAC, no
PII/secrets in logs/prompts/traces, strong typing, validate every trust
boundary.

---

## 0. Guiding principles (locked)

1. **Reads vs. writes are different trust classes.**
   - **Reads** → DB MCP server `run_select_query` against a **read-only**
     Postgres role over **curated, PII-aware views**, behind a hard SQL-safety
     pipeline.
   - **Writes** → **never raw SQL.** They go through the existing typed,
     permission-gated `CapabilityExecutor` (e.g. `sales.create`,
     `issues.create`, `actions.markCompleted`). Raw DML/DDL is permanently
     forbidden on every code path. *(Adopted decision D3.)*
2. **Authorization is the platform's, reused — never re-implemented.** Every new
   tool/skill is bound to the SAME domain permission its REST/capability
   equivalent requires, declared once in `@nova/shared` and mirrored to Python
   via `nova_authz` (CI parity gate).
3. **Every executor re-enforces, fails closed.** The MCP server and the A2A agent
   each validate their audience-restricted token, load + verify the entitlement
   snapshot, and re-check the per-tool/per-skill permission.
4. **The planner/LLM never authorizes.** Layer A filters the toolset to the
   user's entitlements; Layer B (code gate) is authoritative on every hop.
5. **Untrusted by default.** Agent-/model-/tool-provided text is untrusted and
   never overrides system/security instructions; all inputs validated at the
   boundary; all outputs encoded for their sink (SQL, log, JSON).

---

## 1. Current state (delta to close)

| Area | Today | Target |
|---|---|---|
| `db-mcp-server` | One-shot CLI: `AppDataSource.initialize()` → `console.log(describeSchema())` | MCP resource server (Streamable HTTP), auth, read-only SQL tools, audit |
| MCP protocol | None (no SDK, no transport, no `tools/*`) | `@modelcontextprotocol/sdk` server with `initialize`/`tools/list`/`tools/call` + schema resource |
| DB identity for MCP | Shared `AppDataSource` (full business creds) | Dedicated `nova_mcp_readonly` role, SELECT-only on views, `read_only` tx, RLS, timeouts |
| A2A agent adapter (worker) | None — all hops go through Node tool gateway | New `agent_call` node + A2A client in `graph.py` |
| Agent registry / steering | None — `planner.py` is keyword→capability only | Agent registry (Agent Cards) + steering router that falls back to `at-sql-analyser` |
| `agents/at-sql-analyser` | Does not exist | New LangGraph A2A service (MCP client + capability-tool client) |
| Keycloak clients | `nova-mcp-sales`, `nova-agent-sales` exist as examples | Add `nova-mcp-data`, `nova-agent-sql-analyst` + per-hop client scopes |
| Capability catalog | 7 business capabilities | + `data.schema.describe`, `data.query.select`, `data.analyse.read`, `data.act.write` |

---

## 2. Target architecture

```text
React chat ──> nova-api (control plane: authN/Z, snapshot, enqueue by ID)
                  │  aud: nova-orchestrator
                  v
            orchestrator gateway ──> redis-orchestrator ──> Celery worker (exec plane)
                                                               │  loads run + snapshot (postgres-agents)
                                                               │  STEERING SEARCH: choose agent (Layer A skill filter)
                                                               │  Layer B policy gate per hop
                                                               │
                          ┌────────────────────────────────────┼───────────────────────────────────┐
                          v (agent_call)                        v (tool_call: writes / scoped reads)  v (durable state)
              at-sql-analyser  (aud: nova-agent-sql-analyst)   Node tool gateway (capabilities)    postgres-agents
              [A2A LangGraph agent, in-memory harness]          /internal/agent-runs/:id/tool-calls   (runs/steps/events/audit)
                  │  re-enforces snapshot (fetched from control plane)
                  │  aud: nova-mcp-data
                  v
              DB MCP server (aud: nova-mcp-data)  ──► nova_mcp_readonly ──► curated read-only VIEWS (RLS) on business `nova` DB
                  [read-only SELECT tools + schema discovery]
```

The SQL-analyst agent has **two** outbound tool channels, both re-enforcing
authz: the **DB MCP server** for safe read-only surfacing, and the **Node
capability tool gateway** for writes (and for reads needing per-record scoping
the views can't express).

---

## 3. Cross-cutting security model (build first)

### 3.1 Database isolation for the MCP server *(adopted)*
- New TypeORM migration in `@nova/database` (business DB) provisioning:
  - Schema `mcp_read` and a **reviewed allowlist** of curated views (D6).
  - Role `nova_mcp_readonly` (`LOGIN`, `NOSUPERUSER`, `NOCREATEDB`,
    `NOINHERIT`): `GRANT USAGE` on `mcp_read`, `GRANT SELECT` only on the
    allowlisted views. **No grants on base tables, no `public` usage.**
  - `ALTER ROLE nova_mcp_readonly SET default_transaction_read_only = on`,
    `statement_timeout = '5s'`, `idle_in_transaction_session_timeout = '10s'`,
    `lock_timeout = '2s'`.
  - **RLS** on the underlying tables (or `security_barrier` views) keyed off a
    per-session GUC `nova.owner_subject`, set with `SET LOCAL` from the verified
    snapshot subject inside each query transaction, so dynamic SQL cannot escape
    ownership scoping.
- The MCP server uses its **own** pg pool with `nova_mcp_readonly` creds — never
  `AppDataSource`. `describeSchema()` stays metadata-only and is filtered to the
  allowlisted views.

### 3.2 SQL-safety pipeline (`run_select_query`) *(adopted, fail-closed)*
1. **Parse with a real parser** (`pgsql-parser` / libpg_query). Require exactly
   one statement and `SelectStmt`.
2. **Reject**: any DML/DDL/utility statement, multiple statements, `;` stacking,
   CTEs containing writes, `SELECT … INTO`, `COPY`, `pg_*`/`information_schema`,
   set-returning side-effecting functions, locking clauses.
3. **FROM allowlist**: every referenced relation resolves to `mcp_read.*`.
4. **Clamp `LIMIT`** to `SQL_MAX_ROWS` (default 500) and cap result bytes.
5. **Execute** in a `READ ONLY` transaction with `statement_timeout`; set the
   RLS GUC from the snapshot subject in the same transaction.
6. **Redact**: pass rows through the column classifier; drop/mask sensitive
   columns before returning.
7. **Audit** (PII-free): capability, decision, **SQL hash + row count +
   duration**. Never the raw SQL text, parameter values, or row contents.

### 3.3 Capability & permission design *(adopted)*
**Decision D1 — single coarse gate + data-layer scoping.** Introduce one
permission `read-data` that gates *use of* the SQL tool/skill. *Which* data is
exposed is constrained by the `mcp_read` view allowlist + RLS, not by a
permission explosion. This keeps the model simple while keeping exposure
least-privilege.

Add to `backend-services/packages/shared/src/rbac/permissions.ts`:
- `read-data` permission; grant in `ROLE_PERMISSIONS` to roles that may
  free-query the data layer (e.g. `admin`, `support-operations-user`,
  `ops-compliance`; confirm during M1).

Add to `capabilities.ts`:
```ts
{ id: 'data.schema.describe', kind: 'mcp-tool',   mode: 'read',  requiredPermissions: ['read-data'], risk: 'low',  resourceScoped: false },
{ id: 'data.query.select',    kind: 'mcp-tool',   mode: 'read',  requiredPermissions: ['read-data'], risk: 'low',  resourceScoped: true  },
{ id: 'data.analyse.read',    kind: 'agent-skill', mode: 'read', requiredPermissions: ['read-data'], risk: 'low',  resourceScoped: true  },
{ id: 'data.act.write',       kind: 'agent-skill', mode: 'write', requiredPermissions: [],            risk: 'high', resourceScoped: true  },
```
`data.act.write` carries **no** standalone permission and `risk: 'high'`: it is a
*dispatch* skill that may only invoke already-cataloged write capabilities, each
of which is independently gated on its own permission (e.g. `write-sales`) AND
the high-risk approval gate (§3.6). This prevents the agent from minting new
write authority.

Regenerate + parity-check:
```
npm run build -w @nova/shared && npm run rbac:export -w @nova/shared
python services/orchestrator/scripts/generate_nova_authz.py
git diff --exit-code services/orchestrator/src/nova_orchestrator/authz/nova_authz.py
```

### 3.4 Identity, tokens, audiences *(adopted, per-hop restriction)*
Add to `infra/keycloak/nova-realm.dev.json`:
- Confidential resource-server clients (service accounts, standard/direct flows
  disabled): `nova-mcp-data`, `nova-agent-sql-analyst`.
- **Decision D5 — true per-hop audience restriction.** Define client scopes
  (`aud:nova-mcp-data`, `aud:nova-agent-sql-analyst`) and have the worker (and
  the agent, for its outbound MCP call) request a single audience via the
  `scope` parameter so each minted token carries exactly one target audience.
  `ServiceTokenClient` gains a `scope`/`audience` argument and caches per
  audience. `azp` pinning remains as a second control.
- Each resource server validates issuer/aud/exp/nbf/alg/signature (JWKS) and
  pins `azp` to its only authorized caller (worker → agent; agent → MCP).

### 3.5 Snapshot re-enforcement everywhere *(adopted: call-back fetch)*
**Decision D2 — Option A.** The MCP server and the agent fetch the verified
entitlement snapshot for `runId` from a small **internal control-plane
endpoint** (audience-gated, `azp`-pinned), mirroring how the worker fetches the
prompt today. `postgres-agents` stays the single source of truth. Add
`GET /internal/agent-runs/:runId/entitlement` to the Node tool-gateway router,
returning the minimal snapshot (subject, roles, permissions, capabilityAllowlist,
hash, expiry) — never tokens or PII. Both consumers then:
- MCP server: re-run `permissionsSatisfyCapability` (TS) for the called tool.
- Agent: re-run `evaluate_capability` (Py) for the requested skill/action.
Both **fail closed + audit** on hash mismatch, expiry, or missing permission.

### 3.6 Adopted secure-by-design controls (cross-cutting checklist)
From `security-by-design.md` / `python-langgraph-agents.md`, explicitly applied:
- **Web/API hardening (MCP + agent HTTP):** restrictive CORS (no browser origin —
  internal only), secure headers, **request body size limits**, **rate limiting**
  on `tools/call` and the A2A task endpoints, consistent typed error envelope
  (no stack/ORM/internal leakage), no internal URLs in responses.
- **Idempotency:** every tool/agent hop carries an idempotency key
  (`tool-call:{runId}:{capability}:{index}`, `agent-call:{runId}:{skill}:{index}`);
  high-risk mutations are idempotent and replay-safe.
- **Human approval gate:** `risk: 'high'` capabilities (all writes routed via
  `data.act.write`, plus any future destructive op) require a recorded approval
  before execution (reuse `capabilityRequiresApproval`; surface an
  `approval.required` event and block until granted). Default deny without it.
- **Prompt-injection defense:** untrusted content (prompt, schema text, tool
  results) is delimited and labeled as data; system/security instructions are
  never overridable; the model can only see entitled skills (Layer A); Layer B
  re-checks regardless. Add regression tests for injection attempts.
- **Typed A2A envelopes:** every inbound/outbound agent message is schema-
  validated with correlation/trace ids, sender, receiver, purpose, timestamp,
  schema version. No free-form agent commands for privileged operations.
- **Secrets & PII:** secrets only from validated env/secret manager; never
  logged/traced; redact before emit. Classify data; log the minimum; avoid
  persisting prompts/rows; define retention (events/audit retention policy);
  TLS in transit (rediss://, https/JWKS) and encryption at rest for
  `postgres-agents`.
- **Defense in depth confirmed at three layers:** worker gate, agent, MCP server
  — each independently denies (tested in M7).

---

## 4. Deliverable 1 — DB MCP server (production)

### 4.1 Package layout (`backend-services/db-mcp-server/`)
```
src/
  main.ts                      # bootstrap: config, pool, transport, signal handling
  server.ts                    # MCP server: registers tools/resources, capabilities
  transport/http.ts            # Streamable HTTP transport + Express mount + health + hardening
  auth/
    resource-server.ts         # verify aud: nova-mcp-data, pin azp, JWKS (reuse jose pattern)
    snapshot-client.ts         # fetch + verify entitlement snapshot for runId (D2)
    authorize.ts               # capability→permission gate (reuse @nova/shared)
  data/
    readonly-datasource.ts     # nova_mcp_readonly pool (separate from AppDataSource)
    views.ts                   # allowlist of mcp_read.* views + column classification
  schema/describe-schema.ts    # EXISTS — keep; filter output to allowlisted views
  tools/
    describe-schema.tool.ts    # data.schema.describe
    list-views.tool.ts         # advertises queryable surface
    run-select-query.tool.ts   # data.query.select + SQL-safety pipeline
  sql/
    validate-select.ts         # parser-based allowlist (pgsql-parser)
    limits.ts                  # LIMIT/byte clamps, timeouts
    redact.ts                  # column redaction/masking
  audit/audit.ts               # structured, PII-free audit emit
  http/error-envelope.ts       # consistent error mapping (no leakage)
  config.ts                    # typed env (Zod); fail fast
tests/                         # unit + integration (see §10)
Dockerfile
```

### 4.2 Dependencies
`@modelcontextprotocol/sdk`, `pgsql-parser` (libpg_query semantics), `zod`,
`jose`, `pg` (read-only pool), `express` (transport mount + hardening),
`@nova/shared`, `@nova/database` (metadata + view migration only).

### 4.3 MCP protocol surface
- `initialize`: declare `tools` (+ `resources` for schema) capabilities; version
  negotiation.
- `tools/list`: returns only tools the **caller is entitled to** (Layer A) by
  filtering against the snapshot capability allowlist. Each tool ships a
  Zod-derived JSON Schema.
- `tools/call`: dispatch → auth gate → handler → structured result; failures map
  to `isError` results via `error-envelope.ts` (never stack/ORM internals).
- `resources/*`: expose `nova://schema` backed by `describeSchema()`.
- Tools: `describe_schema` (`data.schema.describe`), `list_views`,
  `run_select_query` (`data.query.select`, input `{ sql, params? }`, returns
  `{ columns, rows, rowCount, truncated }`). **No write tool exists, by design.**

### 4.4 Transport, ops, config
- Streamable HTTP in Express; `/health/live` + `/health/ready` (ready pings the
  read-only pool). Body-size limit, rate limiting, secure headers, internal-only
  CORS. Structured logging (`@nova/shared` `createLogger`) — no SQL values, no
  rows. Graceful shutdown drains the pool.
- Typed config (Zod): `MCP_DATA_PORT`, `MCP_READONLY_DATABASE_URL`,
  `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_JWKS_URI`, `MCP_DATA_AUDIENCE=nova-mcp-data`,
  `MCP_DATA_AUTHORIZED_PARTIES=nova-agent-sql-analyst`, `NOVA_API_INTERNAL_URL`
  (snapshot fetch), `SQL_MAX_ROWS`, `SQL_STATEMENT_TIMEOUT_MS`, rate-limit knobs.

### 4.5 Migration (business DB)
TypeORM migration creating `mcp_read`, the curated views (reviewed SQL — a
security boundary), the `nova_mcp_readonly` role, grants, RLS policies, and
per-role settings. Wired into `db:init`.

---

## 5. Deliverable 2 — `agents/at-sql-analyser` (A2A LangGraph agent)

Standalone Python service (own `pyproject.toml`, `uv`), outside the npm
workspaces, per `agents/README.md`.

### 5.1 Package layout
```
agents/at-sql-analyser/
  pyproject.toml
  src/at_sql_analyser/
    config.py                 # typed env; fail fast
    server.py                 # A2A surface (FastAPI): Agent Card + task endpoints + hardening
    envelopes.py              # typed A2A message envelopes (correlation/trace ids, schema ver)
    auth/
      resource_server.py      # verify aud: nova-agent-sql-analyst, pin azp (worker)
      snapshot.py             # fetch + verify run snapshot (reuse orchestrator snapshot logic)
      policy.py               # evaluate_capability for skills + concrete write actions
    mcp/data_client.py        # MCP client → DB MCP server (mints aud: nova-mcp-data, scope-restricted)
    tools/capability_client.py# client → Node capability tool gateway (writes / scoped reads)
    harness/
      state.py                # typed LangGraph state (pydantic/TypedDict)
      graph.py                # bounded plan→generate→execute→observe loop
      nodes.py                # node implementations (pure, testable)
      guards.py               # max-iter, timeouts, cancel, no-progress breaker
    observability/langfuse.py # tracing, PII/secret-scrubbed
    skills.py                 # advertised skills (ids, intents, perms) — mirrors catalog
  tests/
  Dockerfile
```

### 5.2 Typed state
```python
class SqlAnalystState(TypedDict):
    run_id: str
    correlation_id: str
    goal: str
    intent: Literal["read", "write"]
    schema_context: SchemaSnapshot
    plan: list[PlannedStep]
    history: list[QueryAttempt]          # sql_hash, row_count, error, observation
    write_actions: list[CapabilityCall]  # typed; each gated independently
    pending_approval: ApprovalRequest | None
    observations: list[str]
    result: AgentResult | None
    iteration: int
    done: bool
```

### 5.3 Harness loop (bounded; mirrors `graph.py` discipline)
Nodes (each pure, validated output before state update):
1. `load_context` — fetch + verify snapshot; pull schema via MCP.
2. `classify_intent` — read vs write + domain.
3. `plan` (LLM) — only entitled skills/tools are visible (Layer A).
4. `generate_sql` (read) — single SELECT over `mcp_read.*`.
5. `validate` — local pre-checks before the hop.
6. `execute` — read → MCP `run_select_query`; write → `capability_client`
   capability (authoritative write path) **after** Layer B + approval gate.
7. `observe/critique` (LLM) — assess vs goal; refine or finish.
8. `refine` — adjust; loop to (5)/(6).
9. `finalize` — compose answer + deep links; return A2A artifact.

Guardrails (mandatory): `MAX_ITERATIONS`/`MAX_QUERIES`, per-step + total
timeouts, cancellation check between hops, **no-progress breaker** (repeated
identical/errored SQL or empty deltas), explicit termination, no unbounded
recursion. Harness state is ephemeral per run; each completed step is persisted
as an `agent_step` (resumability + audit).

### 5.4 Skills + write authorization
- `data.analyse.read` → free-form data Q&A (gated `read-data`).
- `data.act.write` → dispatch-only gateway; per concrete capability it calls, the
  agent runs Layer B (`evaluate_capability`) AND enforces the high-risk approval
  gate before invoking the tool gateway. The agent never invents write authority.

### 5.5 A2A surface
- Publish a validated **Agent Card** (skills, streaming, auth requirements
  `aud: nova-agent-sql-analyst`).
- Task endpoints (`send_task`/`get_status`/`cancel` + streaming) using typed
  envelopes; resource-server auth + snapshot re-enforcement + per-skill gate;
  fail closed + audit; rate limiting + body-size limits; normalize events to the
  platform schema (§6.4).

---

## 6. Deliverable 3 — Orchestrator integration & steering

### 6.1 Agent registry
`services/orchestrator/src/nova_orchestrator/agents/registry.py`: loads trusted
Agent Cards (config-driven, no trust-on-first-use in prod); validates each card's
skills against the catalog (unknown skill → ignored + logged); exposes
`list_agents()`, `skills_for(agent)`, and the fallback id `at-sql-analyser`.

### 6.2 Steering search (new)
`services/orchestrator/src/nova_orchestrator/steering.py`:
- Input: prompt + snapshot. Output: ordered candidate agents/skills,
  pre-filtered to entitlements (Layer A).
- Phase 1 (deterministic, no LLM — matches `planner.py`): intent keywords + skill
  metadata score candidates; below threshold → **fall back to `at-sql-analyser`**
  iff the user holds `read-data`.
- Phase 2 (drop-in LLM router): same typed contract; Layer B authoritative.
- No `read-data` → fallback **not** offered (default deny); run finalizes with a
  graceful "not entitled / can't help" message.

### 6.3 A2A agent adapter in the graph (new)
Extend `graph.py` with an `agent_call` hop alongside `tool_call`:
- Layer B `evaluate_capability(skill_id, roles)` before dispatch; deny→audit→stop.
- Mint scope-restricted `aud: nova-agent-sql-analyst` token; call A2A `send_task`
  with `runId` only.
- Persist `agent_steps` (`type='agent_call'`, `tool_name=skill_id`,
  `external_task_id`, `agent_name`), idempotency key per step, stream normalized
  events, honor cancel (mirror `_run_one_step`).

### 6.4 Event normalization
Map A2A events → internal types (`agent.call.started/completed/failed`, reuse
`tool.call.*`) with the existing visibility model so the React SSE stream shows
iterative progress with no frontend transport changes.

### 6.5 Data model touch-ups (`postgres-agents`)
Confirm `agent_steps` carries `type='agent_call'`, `external_task_id`,
`agent_name`; add a migration in `packages/database/src/agents/migrations` only
if columns are missing (baseline: `1717400000000-InitialAgentsSchema` +
step-idempotency migration).

---

## 7. Keycloak changes (summary)
- Add clients `nova-mcp-data`, `nova-agent-sql-analyst` (confidential, service
  accounts, standard/direct flows disabled).
- Define `aud:*` client scopes; worker + agent request a single audience via
  `scope` (D5).
- Worker: scope access to both new audiences. Agent: scope access to
  `nova-mcp-data`. Dev secrets follow the `*-dev-secret` convention; prod from a
  managed store with documented rotation.

## 8. docker-compose changes
- `db-mcp-server`: build, env for `MCP_READONLY_DATABASE_URL` (the
  `nova_mcp_readonly` role), JWKS/issuer/audience, `NOVA_API_INTERNAL_URL`;
  depends_on `db-init` (mcp_read migration ran) + keycloak healthy; not published
  to host; healthcheck on `/health/ready`.
- `at-sql-analyser`: build, env for issuer/JWKS, `aud: nova-agent-sql-analyst`,
  MCP URL, tool-gateway URL, Langfuse, worker-style client creds for outbound
  tokens; depends_on db-mcp-server + keycloak.
- `db-init`: add the `mcp_read`/role migration.
- `celery-worker`: add `SQL_ANALYST_AGENT_URL`, `DB_MCP_URL`, steering/fallback
  config; new client scopes cover tokens.

---

## 9. RBAC parity & CI
All capability/permission edits land in `@nova/shared` first, regenerate
`nova_authz.py`; `test_registry_parity.py` + `test_snapshot_parity.py` guard
drift. Add a contract test asserting each new capability's `requiredPermissions`
matches its REST/capability equivalent.

## 10. Testing strategy (test-first per milestone)
- **MCP SQL safety (top priority):** parser rejects DML/DDL, multi-statement,
  `pg_*`/`information_schema`, non-allowlisted FROM; LIMIT/timeout/byte caps and
  RLS scoping hold; read-only role blocks writes at the engine even if a check is
  bypassed; classic injection payloads denied.
- **AuthZ multi-layer (three layers):** independent deny at worker, agent, MCP;
  snapshot tamper/expiry → fail closed + audit; missing audience/`azp` rejected.
- **Steering/fallback:** targeted-agent match wins; no match → `at-sql-analyser`;
  user without `read-data` → no fallback, graceful refusal.
- **Harness guardrails:** max-iter/timeout/no-progress termination; cancellation
  mid-loop; idempotent step replay; approval gate blocks writes until granted.
- **Prompt injection:** regression suite proving injected "ignore rules / call
  tool X" cannot widen the allowlist or bypass Layer B.
- **PII/secrets:** audit/log/trace payloads never contain rows, SQL values,
  secrets, or tokens.
- **Evals:** core read questions + guarded write flows scored for correctness +
  safety. Mock LLM/tool calls for deterministic unit/integration tests.

## 11. Observability (Langfuse)
Trace the harness (plan/generate/execute/observe) with scrubbed spans: SQL
hashes, view names, row counts, decisions — never raw SQL values, rows, tokens,
or PII. Reuse platform redaction helpers.

---

## 12. Milestones (all included, detailed)

Each milestone is independently shippable, test-first, and ends with explicit
exit criteria + validation commands. Suggested validation per milestone (Node):
`npm run lint && npm run typecheck && npm test` in the affected workspace;
(Python): `ruff check . && mypy . && pytest`.

### M0 — Decisions & foundation (no runtime code)
- **Goal:** lock the secure-by-design decisions and scaffolding before code.
- **Tasks:** record adopted decisions D1–D6 (§13); confirm the role→`read-data`
  grants; confirm the `mcp_read` view/column allowlist + classification with a
  PII review; confirm retention/TLS expectations for `postgres-agents`.
- **Deliverables:** this document finalized; a short ADR per decision if desired.
- **Exit:** stakeholders sign off on the view allowlist and the write-path rule.

### M1 — Security foundation (RBAC + DB isolation + identity)
- **Goal:** every authorization primitive exists and is parity-checked before any
  executor uses it.
- **Tasks:**
  - `@nova/shared`: add `read-data` permission + role grants; add the four
    capabilities (§3.3); export registry; regenerate `nova_authz.py`.
  - `@nova/database`: migration for `mcp_read` schema, curated views (reviewed
    SQL), `nova_mcp_readonly` role + grants + RLS + per-role settings; wire into
    `db:init`.
  - Keycloak: add `nova-mcp-data` + `nova-agent-sql-analyst` clients and `aud:*`
    client scopes; grant worker/agent scope access (D5).
  - `ServiceTokenClient` (Py): add per-audience `scope` + per-audience caching.
  - Node: add `GET /internal/agent-runs/:runId/entitlement` (audience-gated,
    `azp`-pinned, PII-free) for snapshot re-enforcement (D2).
- **Tests:** registry/snapshot parity; capability↔permission contract test;
  migration applies cleanly; read-only role cannot write (integration);
  entitlement endpoint denies wrong audience/azp.
- **Exit:** parity CI green; role/grants verified in a throwaway DB; entitlement
  endpoint returns verified snapshot only to authorized callers.
- **Validation:** `npm run build -w @nova/shared && npm run rbac:export -w @nova/shared && python services/orchestrator/scripts/generate_nova_authz.py && git diff --exit-code …`; `pytest services/orchestrator/tests/test_registry_parity.py`.

### M2 — DB MCP server (read-only, production)
- **Goal:** a spec-compliant MCP resource server exposing safe read tools.
- **Tasks:**
  - Add SDK + Streamable HTTP transport + Express hardening (CORS/headers/body
    limit/rate limit) + health endpoints.
  - `resource-server.ts` (verify `aud: nova-mcp-data`, pin `azp`),
    `snapshot-client.ts` (D2), `authorize.ts` (capability gate).
  - `readonly-datasource.ts` (`nova_mcp_readonly` pool); `views.ts` allowlist +
    column classification.
  - Tools: `describe_schema`, `list_views`, `run_select_query` with the full
    §3.2 SQL-safety pipeline (`validate-select`, `limits`, `redact`) + PII-free
    audit; `resources/*` schema resource.
  - `tools/list` filters by entitlement (Layer A).
  - Config (Zod), Dockerfile, compose service.
- **Tests:** SQL-safety suite (§10, top priority), auth/snapshot fail-closed,
  redaction, `tools/list` entitlement filtering, RLS scoping, error-envelope (no
  leakage).
- **Exit:** an authorized caller can `describe_schema` + run a safe SELECT; every
  unsafe/over-privileged path is denied + audited; container healthy.
- **Validation:** `npm run lint && npm run typecheck && npm test -w @nova/db-mcp-server`; `docker compose up db-mcp-server`.

### M3 — `at-sql-analyser` agent (read path)
- **Goal:** a bounded LangGraph agent that answers data questions via the MCP
  server, fully authorized, no writes yet.
- **Tasks:**
  - Scaffold `agents/at-sql-analyser` (pyproject, ruff/mypy, tests).
  - Typed state + graph (`load_context`→`classify_intent`→`plan`→`generate_sql`→
    `validate`→`execute(read)`→`observe`→`refine`→`finalize`) with guards.
  - `mcp/data_client.py` (MCP client, scope-restricted token); `auth/*`
    (resource server, snapshot, policy); `envelopes.py`.
  - A2A `server.py` (Agent Card + task endpoints + hardening); Langfuse scrubbed
    tracing.
- **Tests:** node unit tests (mock LLM/MCP); graph transitions; guardrails
  (max-iter/timeout/no-progress/cancel); prompt-injection regression; auth
  fail-closed; PII/secret scrubbing in traces.
- **Exit:** given a data question + snapshot, the agent iterates safe SELECTs and
  returns a grounded answer; unauthorized/injection attempts denied.
- **Validation:** `ruff check . && mypy . && pytest` in the agent package.

### M4 — Orchestrator A2A adapter + registry (agent reachable e2e)
- **Goal:** the worker can dispatch the agent as a hop, end to end.
- **Tasks:**
  - `agents/registry.py` (Agent Card loading + skill validation).
  - `graph.py`: `agent_call` hop (Layer B gate, scope-restricted token, A2A
    `send_task` by ID, `agent_steps` persistence + idempotency, cancel, event
    normalization §6.4).
  - `agent_steps` migration if columns missing; compose wiring (`SQL_ANALYST_AGENT_URL`, `DB_MCP_URL`).
- **Tests:** adapter unit tests (mock A2A); event normalization; idempotent step
  replay; cancel mid-call; Layer B deny path.
- **Exit:** a run that hits `data.analyse.read` reaches the agent, streams
  progress, and finalizes; deny paths audited.
- **Validation:** `pytest services/orchestrator/tests`; local `docker compose up` smoke.

### M5 — Steering search + default fallback
- **Goal:** intent-based agent selection with `at-sql-analyser` as the entitled
  fallback.
- **Tasks:** `steering.py` (Layer A pre-filter, keyword/metadata scoring,
  threshold → fallback); integrate into `execute_plan` before dispatch; wire
  graceful refusal when `read-data` absent.
- **Tests:** targeted match wins; no match → fallback; no `read-data` → no
  fallback + graceful message; fallback respects entitlements.
- **Exit:** chat questions with no targeted agent route to `at-sql-analyser` only
  for entitled users.
- **Validation:** `pytest` steering tests.

### M6 — Write path (typed capabilities + approval gate)
- **Goal:** the agent can act on behalf of the user safely.
- **Tasks:** `data.act.write` dispatch skill; `tools/capability_client.py`
  (calls Node tool gateway capabilities); per-action Layer B + high-risk approval
  gate (`approval.required` event, block until granted); idempotent mutations.
  No raw SQL writes anywhere (enforced + asserted).
- **Tests:** write only via cataloged capabilities; per-action permission deny;
  approval gate blocks then allows; idempotent replay; audit completeness.
- **Exit:** an entitled user can drive a guarded write (e.g. create issue) with a
  recorded approval; unauthorized writes denied at every layer.
- **Validation:** `pytest` agent + orchestrator; multi-layer authz tests.

### M7 — Hardening, observability, and release gates
- **Goal:** production readiness sign-off.
- **Tasks:** end-to-end three-layer authz tests (worker/agent/MCP independent
  deny); full prompt-injection + SQL-injection regression sweep; load/timeout/
  rate-limit verification; Langfuse PII-scrub audit; secrets/rotation review;
  retention + TLS confirmation; runbook + dashboards.
- **Tests/Checks:** all suites green; code-review-checklist self-review; skill
  library validator.
- **Exit:** all milestones' tests pass in CI; security review signed off.
- **Validation:** `python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py`; full lint/typecheck/test across affected workspaces and Python packages.

---

## 13. Adopted decisions (was: open questions)
- **D1 — Permission shape:** single coarse `read-data` gate + `mcp_read` view
  allowlist + RLS for data scoping. *(Adopted; §3.3.)*
- **D2 — Snapshot delivery:** call-back fetch from a new audience-gated control-
  plane endpoint; `postgres-agents` remains source of truth. *(Adopted; §3.5.)*
- **D3 — Write strategy:** writes exclusively through the existing typed
  `CapabilityExecutor` capabilities; raw-SQL writes never in scope. *(Adopted; §0.)*
- **D4 — MCP hosting:** standalone container (clean audience boundary, least
  privilege). *(Adopted; §8.)*
- **D5 — Per-hop audience:** single-audience tokens via `scope`-selected client
  scopes; `azp` pinning retained. *(Adopted; §3.4.)*
- **D6 — Curated views:** `mcp_read` exposes a reviewed, PII-aware view set;
  sensitive columns masked/excluded; changes treated as security-sensitive.
  *(Adopted; final allowlist confirmed in M0/M1 PII review.)*

Remaining product input (not blocking design): the exact role→`read-data` grant
list and the precise `mcp_read` view/column allowlist, both finalized during the
M0/M1 PII review.
```
