# Nova SQL Analyser Agent (`at-sql-analyser`)

`at-sql-analyser` is Nova's **default data agent**: an A2A (Agent-to-Agent) service
built on `a2a-sdk` and **LangGraph** that answers data questions and performs guarded
writes on the user's behalf. It is the agent the orchestrator delegates to whenever a
request is about retrieving, analysing, or acting on business data and no more
specific agent matches.

It surfaces the data layer through **two outbound channels**, each re-enforcing
authorization:

- **Reads** → the **DB MCP server** (`run_select_query`, `describe_schema`) over
  curated, PII-aware `mcp_read.*` views, plus entitled **structured read** capabilities.
- **Writes** → the **Node capability tool gateway** (typed, permission-gated
  capabilities such as `issues.create`). **Raw SQL writes are never possible.**

- **Language / runtime:** Python `>=3.11` (Docker image: `python:3.12-slim`)
- **Package:** `at_sql_analyser` (`src/at_sql_analyser/`)
- **Entry point:** `uvicorn at_sql_analyser.main:app` on port **8003**
- **Agent name:** `at-sql-analyser`

---

## 1. Role in the solution architecture

```text
orchestrator worker ──(A2A send_task, aud: nova-agent-sql-analyst)──► at-sql-analyser
                                                                          │
   ┌──────────────────────────────────────────────────────────────────────┤
   │ verify inbound JWT (aud + azp pin)                                     │
   │ fetch + verify entitlement snapshot by runId (from nova-api)           │
   │ Layer B authorize() every capability                                   │
   │ run bounded LangGraph harness (plan → generate → execute → critique)   │
   └──────────────────────────────────────────────────────────────────────┘
        │ reads (aud: nova-mcp-data)              │ writes (aud: nova-mcp-sales)
        ▼                                         ▼
   DB MCP server  ──► mcp_read views        nova-api tool gateway ──► permission-gated
                                                                      capabilities
```

The agent is **untrusted-by-default** and re-derives all of its authority from the
run's entitlement snapshot:

1. The orchestrator's task message carries **only** typed IDs (`runId`, `skillId`,
   `goal`, `approvalGranted`, `conversationId`, Langfuse trace ids) — never the
   snapshot or a user token.
2. The agent fetches the verified snapshot for `runId` from the control plane and
   re-runs the Layer B policy gate (`evaluate_capability`) for **every** read/write.
3. Raw SQL, rows, and PII never appear in A2A artifacts/events/logs by design.

The orchestrator treats `data.analyse.read` as the **default** skill for
retrieve/analyse questions; the agent advertises the same in its read skill
description.

---

## 2. Tech stack & dependencies

From `pyproject.toml`:

| Concern | Library |
|---|---|
| A2A / HTTP | `a2a-sdk[http-server] >=0.3,<0.4`, `starlette`, `uvicorn[standard]` |
| Orchestration / LLM | `langgraph`, `langchain-core`, `langchain-openai` |
| MCP client | `mcp >=1.0,<2` (Streamable HTTP) |
| JWT | `pyjwt[crypto]` |
| HTTP / data / config | `httpx`, `pydantic`, `redis` |
| Observability (optional `[observability]`) | `langfuse >=3,<4`, `langchain >=0.3,<1` |
| Dev | `pytest`, `pytest-asyncio`, `mypy`, `ruff`, `types-redis` |

---

## 3. A2A surface (`server.py`)

### Agent Card (`build_agent_card`)

- `name`: `at-sql-analyser`
- `description`: "Read-only SQL analyst over curated, PII-aware business views."
- `capabilities`: `streaming=True`, `push_notifications=False`
- I/O modes: `text/plain`, `application/json`
- `skills`: from `advertised_skills(catalog)` — the read skill is enriched at startup
  with the live view catalog fetched from the DB MCP server (`/catalog`).
- `url`: `AGENT_PUBLIC_URL`

### App (`create_app`)

`A2AStarletteApplication` with a `DefaultRequestHandler` backed by `SqlAnalystExecutor`
and an `InMemoryTaskStore`, plus a `GET /health` route. The whole app is wrapped in
`BearerAuthMiddleware`.

### Authentication boundary (`BearerAuthMiddleware`)

- **Unauthenticated:** `GET /health` and `GET /.well-known/*` (Agent Card discovery).
- **Everything else:** `ResourceServer.verify(Authorization)`; failure → `401
  {"error":"unauthorized"}`. On success the verified caller is stashed on the request
  scope.

> Note: there is no in-package CORS, rate-limit, or body-size middleware. Edge
> hardening is handled by network placement and orchestrator timeouts; in-process
> hardening here is fail-closed Bearer auth + `azp` pinning, the bounded harness,
> local SQL pre-validation, and per-capability Layer B re-authorization.

### Task execution (`SqlAnalystExecutor`)

The `DataPart` payload (typed data only) carries `runId`, `skillId`, `goal`,
`approvalGranted`, `conversationId`, `langfuseTraceId`, `langfuseParentObservationId`,
and an optional `correlationId`. The pipeline is `submit → start_work → snapshot →
_run_read | _run_write → terminal artifact`.

The terminal artifact is a `DataPart` (`status`, `reason`, `answer`, `events`) plus an
optional `TextPart`, mapped to A2A states: `completed`, `needs_approval`
(`requires_input`), `denied` (`reject`), else `failed`. Streaming sub-events
(`_SubEventStreamer`) emit `TaskState.working` frames whose metadata `novaEvent`
carries `type`, `payload`, and `agentSeq`; the terminal `events` list is the
reconciliation source of truth. `cancel` maps to `TaskUpdater.cancel()`.

### Self-registration (`registration.py`)

`AgentRegistrar.register_once` POSTs `{name, baseUrl, audience, card}` to
`{orchestrator}/internal/agents/register` (token via `ServiceTokenClient`), heartbeats
every `A2A_REGISTRATION_HEARTBEAT_SECONDS` (default 60), and `DELETE`s on shutdown.
It is fail-soft and never blocks serving.

---

## 4. The bounded harness (`harness/`)

A LangGraph DAG with strict guardrails. Reads and writes use different sub-graphs.

**Read path:**

```text
start → load_schema → plan_read ─┬─► validate → execute → critique ─┐
                                 ├─► dispatch_read ──────────────────┤
                                 └─► compose → END                   │
                                  ▲ (loop: critique → plan_read) ◄────┘
```

**Write path:**

```text
start → plan_write ─┬─► resolve_read → (loop) plan_write
                    ├─► dispatch_writes → compose_writes → END
                    └─► compose_writes (nothing to do) → END
```

Every node is wrapped with `instrument` (emits `agent.node.started` /
`agent.node.completed`). Key nodes: `load_schema` (MCP `describe_schema`), `plan_read`
/ `plan_write` (LLM planning), `validate` (`local_validation_error`), `execute`
(`run_select_query`), `dispatch_read` / `dispatch_writes` (capability gateway),
`critique`, `compose` / `compose_writes`, and `resolve_read` (resolve human handles
before a write).

### Typed state (`harness/state.py`)

`GraphState` includes `run_id`, `goal`, `intent`, `started_monotonic`, `schema`,
`attempts` (append reducer), `iteration`, `route`, `pending_sql`/`pending_params`,
`pending_read`, `write_calls`, `write_outcomes`, `answer`, `reason`, `status`, built
from typed value objects (`SchemaView`, `QueryAttempt`, `CapabilityCall`,
`WriteOutcome`, `TaskInput`, `AgentResult`). `GraphDeps` injects the `reasoner`,
guard `limits`, optional `data_client` / `capability_client`, `authorize`,
`sql_enabled`, `on_event`, `clock`, conversation history, and Langfuse callbacks.

### Guardrails (`harness/guards.py`)

`GuardLimits` (`max_iterations`, `max_queries`, `total_timeout_s`) drives
`evaluate_guards`, which stops the loop with an explicit reason:

- `time_budget_exhausted`
- `iteration_budget_exhausted`
- `query_budget_exhausted`
- `no_progress` (same `sql_hash` twice, or consecutive errors)

The LangGraph `recursion_limit` is derived from the limits
(`max(max_iterations, max_queries) * 4 + 8`).

### Local SQL pre-check (`local_validation_error`)

Before any MCP hop, the agent locally requires a single `SELECT`/`WITH` over the
`mcp_read` schema and blocks write keywords, `pg_*`, `information_schema`, and
multiple statements. This is defense-in-depth; the DB MCP server remains the
authoritative validator.

---

## 5. Read path (`mcp/data_client.py`)

`McpDataClient` speaks MCP Streamable HTTP to `{DB_MCP_URL}/mcp` with
`Authorization: Bearer <token>` and `X-Nova-Run-Id`. The token is minted for
`MCP_AUDIENCE_SCOPE` (default `nova-mcp-data`). It calls `describe_schema` (no args)
and `run_select_query` (`sql`, optional `params`); errors surface as `DataClientError`
carrying only the server's safe `{error, message}` (no SQL/rows). The startup catalog
fetch (`mcp/catalog_client.py`) is a fail-soft `GET {base}/catalog` used to enrich the
Agent Card.

Free-form SQL is only enabled when the snapshot allows
`data.query.select` (`SKILL_QUERY_SELECT`).

---

## 6. Write path (`tools/capability_client.py`)

There are **no raw SQL writes**. `HttpCapabilityClient.execute` POSTs to
`{NOVA_API_INTERNAL_URL}/internal/agent-runs/{run_id}/tool-calls` with
`{capabilityId, input, idempotencyKey}`, a Bearer token for
`CAPABILITY_AUDIENCE_SCOPE` (default `nova-mcp-sales`), and an `Idempotency-Key`
header. A `403` fails closed with no retry; a `401` invalidates the cached token. The
result is a `CapabilityResult(summary, links, data)`.

Idempotency keys are deterministic per step: reads
`agent-read:{run_id}:{capability_id}:{index}`, writes
`agent-write:{run_id}:{capability_id}:{index}`. The write skill entry authorizes
`SKILL_ACT_WRITE` with `has_approval=task.approval_granted`; an `approval_required`
reason yields a `needs_approval` status and an `approval.required` event.

---

## 7. Authorization

| Layer | Module | Responsibility |
|---|---|---|
| Inbound JWT | `auth/resource_server.py` | `ResourceServer.verify`: JWKS, `aud = AGENT_AUDIENCE` (default `nova-agent-sql-analyst`), `iss`, `exp`, algorithms `RS256`/`ES256`; **`azp` must be in `authorized_parties`** (default `nova-celery-worker`) → `VerifiedCaller` |
| Snapshot | `auth/snapshot.py` | `GET {NOVA_API_INTERNAL_URL}/internal/agent-runs/{runId}/entitlement`, recompute `compute_snapshot_hash` (must match TS), check expiry; fail closed (`SnapshotError`) |
| Wrapper | `auth/policy.py` | `authorize(snapshot, capability_id, has_approval)`: allowlist check then `evaluate_capability` |
| Layer B gate | `authz/policy_gate.py` | `evaluate_capability` → reasons `unknown_capability`, `missing_permission`, `approval_required`, `allowed` |
| Registry | `authz/rbac_registry.py` + `authz/registry.py` | Dynamic DB-driven registry (fetch/cache, fail closed); `read_capability_ids()` / `write_capability_ids()` over the active policy |
| Outbound tokens | `auth/tokens.py` | `ServiceTokenClient` client-credentials, per-scope cache |

**Layer A** filters the planner menu to entitled read/write capabilities
(`_authorized_read_ids` / `_authorized_write_ids`); **Layer B** re-authorizes inside
`_dispatch_read` / `_dispatch_writes` before each gateway/MCP call. Advertising a
skill is discovery — it is never authorization.

---

## 8. Skills (`skills.py`)

| Skill ID | Required permission | Risk | Purpose |
|---|---|---|---|
| `data.analyse.read` | `create-agent-run` | low | Broad data Q&A; the **default** for analyse/retrieve intents |
| `data.act.write` | `create-agent-run` | high | Dispatch-only gateway to typed write capabilities (approval-gated) |

The MCP tools `data.schema.describe` and `data.query.select` exist for the agent's own
use but are not part of the planner menus. Concrete delegated reads
(`customers.search`, `sales.list`, `issues.get`, `sop.read`, …) and writes
(`sales.create`, `issues.create`, `actions.markCompleted`, …) each carry their own
domain permission and are gated independently.

---

## 9. Prompts & content policy

`prompts.py` defines system prompts (`PLAN_READ_SYSTEM`, `CRITIQUE_SYSTEM`,
`COMPOSE_SYSTEM`, `PLAN_WRITE_SYSTEM`) with strict prompt-injection discipline:
untrusted content (the goal, schema text, tool results) is wrapped in `<<< ... >>>`
data blocks and explicitly labeled as data; embedded instructions are ignored, and the
prompt states that selecting a tool is **not** the same as being authorized to use it.
`content_policy.py` gates persisted answer text on the run's allowlist and strips
secret-like keys before anything is written to shared state.

---

## 10. Observability

Two layers:

1. **`observability/tracing.py`** — `LoggingTracer` + `scrub()`, which forbids keys
   like `sql`, `rows`, `goal`, `answer`, `token`, and PII-ish fields from harness
   trace events.
2. **`observability/langfuse_tracing.py`** (optional, fail-soft) — `agent_trace()`
   joins the orchestrator's trace via the forwarded parent ids; `make_callback_handler()`
   wires LangGraph/LangChain; `tool_span()` wraps MCP/capability calls; `mask()` strips
   secrets/JWTs/API keys with depth/size caps; `flush()` at task end. The
   `a2a-python-sdk` instrumentation scope is blocked.

Owner-visible SSE/webhook events may include verbatim SQL/rows in `agent.query.*`
events (the owner is entitled to their own data); the Langfuse/logging traces always
scrub them.

---

## 11. Configuration (`config.py`)

`load_config()` returns a frozen `AgentConfig`; missing `KEYCLOAK_ISSUER_URL` or
`OPENAI_API_KEY` raises `ConfigError`. Selected variables:

| Env var | Default | Purpose |
|---|---|---|
| `AGENT_PORT` / `AGENT_PUBLIC_URL` | `8003` / derived | Listen port / advertised URL |
| `KEYCLOAK_ISSUER_URL` | **required** | JWT issuer |
| `KEYCLOAK_JWKS_URI` / `KEYCLOAK_TOKEN_URL` | derived | JWKS / token endpoints |
| `AGENT_AUDIENCE` | `nova-agent-sql-analyst` | Inbound JWT audience |
| `AGENT_AUTHORIZED_PARTIES` | `nova-celery-worker` | Allowed inbound `azp` |
| `AGENT_CLIENT_ID` / `AGENT_CLIENT_SECRET` | `nova-agent-sql-analyst` / `""` | OAuth client for outbound tokens |
| `MCP_AUDIENCE_SCOPE` | `nova-mcp-data` | DB MCP server audience |
| `CAPABILITY_AUDIENCE_SCOPE` | `nova-mcp-sales` | Tool gateway audience |
| `AGENT_REQUEST_AUDIENCE_SCOPES` | `false` | Request audience as OAuth scope |
| `ORCHESTRATOR_INTERNAL_URL` / `ORCHESTRATOR_AUDIENCE_SCOPE` | `http://orchestrator:8001` / `nova-orchestrator` | Registration |
| `A2A_REGISTRATION_ENABLED` / `A2A_REGISTRATION_HEARTBEAT_SECONDS` | `true` / `60` | Self-registration |
| `NOVA_API_INTERNAL_URL` | `http://nova-api:3000` | Snapshot + tool gateway base |
| `DB_MCP_URL` | `http://db-mcp-server:8002` | DB MCP server base |
| `AGENT_MAX_ITERATIONS` / `AGENT_MAX_QUERIES` / `AGENT_TOTAL_TIMEOUT_S` | `6` / `8` / `120` | Harness guards |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | **required** / optional | LLM credentials |
| `LLM_MODEL` / `LLM_TEMPERATURE` / `LLM_TIMEOUT_S` | `gpt-4o-mini` / `0.0` / `30.0` | LLM config |
| `REDIS_AGENT_URL` / `AGENT_STATE_ENABLED` | optional / `true` | Shared state / history |

---

## 12. Tests (`tests/`)

| File | Focus |
|---|---|
| `test_server.py` | A2A end-to-end: public card, catalog-enriched read skill, read/write tasks, streaming/`novaEvent`, 401, allowlist deny, approval gate, snapshot unavailable |
| `test_harness.py` | Graph with `FakeReasoner`: SQL loop, timeout guard, capability read chains, Layer B re-gate, menu filtering |
| `test_write.py` | Write dispatch, idempotency, per-action denial, resolve-then-write, PII-free events |
| `test_injection.py` | Injected goals cannot trigger writes, unentitled capabilities, or bypass approval |
| `test_guards.py` | All guard stop reasons |
| `test_policy.py` | `authorize` / allowlist / approval / unknown capability |
| `test_snapshot_hash.py` | `compute_snapshot_hash` invariants |
| `test_tracing.py` | `scrub()` forbidden keys + truncation |
| `test_registration.py` | Registrar POST / heartbeat / deregister |
| `test_catalog_client.py` | `fetch_catalog` fail-soft |
| `test_agent_state.py` | Redis history, owner scope, content policy |

---

## 13. File map

| Path | Description |
|---|---|
| `src/at_sql_analyser/main.py` | `build()` → `create_app(load_config())`; ASGI `app` |
| `src/at_sql_analyser/server.py` | A2A app, `SqlAnalystExecutor`, auth middleware, streaming, card |
| `src/at_sql_analyser/config.py` | Frozen `AgentConfig` from env |
| `src/at_sql_analyser/skills.py` | Advertised skills + catalog-backed read description |
| `src/at_sql_analyser/registration.py` | Orchestrator register/heartbeat/deregister |
| `src/at_sql_analyser/agent_state.py` | Redis run section + conversation history |
| `src/at_sql_analyser/prompts.py` | LLM prompts + injection discipline |
| `src/at_sql_analyser/content_policy.py` | Entitlement-gated persistence + secret stripping |
| `src/at_sql_analyser/auth/resource_server.py` | Inbound JWT + `azp` pin |
| `src/at_sql_analyser/auth/tokens.py` | Outbound client-credentials cache |
| `src/at_sql_analyser/auth/snapshot.py` | Entitlement fetch + hash verify |
| `src/at_sql_analyser/auth/policy.py` | `authorize()` (allowlist + gate) |
| `src/at_sql_analyser/authz/policy_gate.py` | `evaluate_capability` reason codes |
| `src/at_sql_analyser/authz/registry.py` | Active-registry helpers, read/write id lists |
| `src/at_sql_analyser/authz/rbac_registry.py` | Dynamic RBAC registry client + active-policy holder (fail closed) |
| `src/at_sql_analyser/mcp/data_client.py` | MCP `describe_schema` / `run_select_query` |
| `src/at_sql_analyser/mcp/catalog_client.py` | Startup `GET /catalog` |
| `src/at_sql_analyser/tools/capability_client.py` | Node tool-call gateway client |
| `src/at_sql_analyser/harness/graph.py` | LangGraph DAG, dispatch, guards, `run_task` |
| `src/at_sql_analyser/harness/state.py` | Typed state + result models |
| `src/at_sql_analyser/harness/guards.py` | `GuardLimits`, `evaluate_guards` |
| `src/at_sql_analyser/harness/llm.py` | `Reasoner`, `OpenAIReasoner`, planning steps |
| `src/at_sql_analyser/observability/tracing.py` | `scrub`, `LoggingTracer` |
| `src/at_sql_analyser/observability/langfuse_tracing.py` | Langfuse v3 integration |
| `Dockerfile` | Python 3.12, non-root user, port 8003 |
| `.env.example` | Local env template |
| `tests/*.py` | Hermetic tests with fakes |

---

## 14. Local development

```bash
# from agents/at-sql-analyser/
uv sync                       # or: pip install -e .[observability]
ruff check .
mypy .
pytest
```

In Docker the service is started by the root `docker-compose.yml` and depends on the
DB MCP server, the Node tool gateway, Keycloak, and (optionally) the agent-state Redis.

---

## 15. Keycloak usage (validated against the code)

The agent is a service-only Keycloak client: it **verifies** the inbound worker token
and **mints** audience-restricted tokens for each of its outbound hops. It never
handles a user login.

### Inbound verification (`auth/resource_server.py`)

`ResourceServer.verify`, invoked by `BearerAuthMiddleware` for every non-public HTTP
request:

- JWKS signature verification with `jwt.PyJWKClient(jwks_uri)`.
- `jwt.decode(..., algorithms=["RS256","ES256"], audience=AGENT_AUDIENCE
  (nova-agent-sql-analyst), issuer=KEYCLOAK_ISSUER_URL,
  options={"require": ["exp","iss","aud"]})`.
- **`azp` pin** to `authorized_parties` (`AGENT_AUTHORIZED_PARTIES`, default
  `nova-celery-worker`) — only the orchestrator worker may task the agent.
- Failure → `AuthError` → `401`. `GET /health` and `/.well-known/*` are exempt.

### Outbound minting (`auth/tokens.py`)

`ServiceTokenClient` runs the **`client_credentials`** grant against
`KEYCLOAK_TOKEN_URL` with `AGENT_CLIENT_ID` / `AGENT_CLIENT_SECRET`, caching one token
per target audience. Audiences per hop:

| Hop | Audience scope (env) |
|---|---|
| DB MCP server (`run_select_query`, `describe_schema`, `/catalog`) | `MCP_AUDIENCE_SCOPE` = `nova-mcp-data` |
| Node capability tool gateway (writes / scoped reads) | `CAPABILITY_AUDIENCE_SCOPE` = `nova-mcp-sales` |
| Entitlement snapshot fetch (`auth/snapshot.py`) | the same MCP-data scope against `nova-api` |
| Orchestrator self-registration (`registration.py`) | `ORCHESTRATOR_AUDIENCE_SCOPE` = `nova-orchestrator` |

`AGENT_REQUEST_AUDIENCE_SCOPES` toggles whether the audience is forwarded as an OAuth
`scope` or supplied via realm protocol mappers.

### Configuration

`KEYCLOAK_ISSUER_URL` is **required** (`load_config` raises otherwise);
`KEYCLOAK_JWKS_URI` and `KEYCLOAK_TOKEN_URL` are derived from the issuer. The
entitlement snapshot's integrity is enforced by hash recomputation (§7), not by
Keycloak. Files: `auth/resource_server.py` (verify), `auth/tokens.py` (mint),
`auth/snapshot.py` (token use), `config.py` (URLs/audiences).
