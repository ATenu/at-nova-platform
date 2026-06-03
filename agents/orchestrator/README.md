# Nova Orchestrator (`nova-orchestrator`)

The orchestrator is Nova's **agent execution plane**. It is the Python service that
actually *runs* agentic work: it consumes run requests enqueued by the Node.js
control plane (`@nova/api`), drives a bounded **LangGraph** reasoning loop, delegates
all business work to registered **A2A agents**, persists every step and event to the
agents database, and streams live progress back to the browser. It is deliberately a
**pure delegator** — it never executes business tools itself and never sees user
secrets.

- **Language / runtime:** Python `>=3.11` (Docker image: `python:3.12-slim`)
- **Package:** `nova-orchestrator` (`src/nova_orchestrator/`)
- **Deployed as three roles from one image:** FastAPI **gateway**, Celery **worker**, Celery **beat/webhook dispatcher**

---

## 1. Role in the solution architecture

Nova separates a **control plane** (trusted, user-facing) from an **execution plane**
(this service). The split exists so that the broker, the LLM, and the agents never
receive a user's token, prompt text, or any secret material — only opaque IDs.

```text
React chat ──► nova-api (CONTROL PLANE)
                 │  • verifies user JWT + RBAC
                 │  • builds immutable EntitlementSnapshot (+ canonical hash)
                 │  • persists run + snapshot to postgres-agents
                 │  • stores prompt in business DB (prompt_ref)
                 │  • enqueues by ID only
                 ▼   POST /internal/runs   (aud: nova-orchestrator)
        ┌────────────────────────── ORCHESTRATOR (this service) ──────────────────────────┐
        │  gateway (FastAPI)  ──►  Redis broker  ──►  Celery worker                          │
        │                                              │  loads run + snapshot (postgres-agents)│
        │                                              │  verifies snapshot hash + expiry       │
        │                                              │  LangGraph loop (reason → dispatch …)  │
        │                                              ▼                                        │
        │                                   A2A agent hop (send_task)                           │
        └───────────────────────────────────────────────────────────────────────────────────┘
                 │ aud: nova-agent-sql-analyst                 ▲ events / steps / audit
                 ▼                                             │ (transactional outbox)
        at-sql-analyser (and future agents)            postgres-agents (source of truth)
```

Key consequences of this design:

- **No prompt on the queue.** The Celery payload carries only `runId`, `requestId`,
  `idempotencyKey`, `actingSubject`, `entitlementSnapshotId`, `entitlementSnapshotHash`.
  The worker fetches the prompt by ID from the control plane.
- **No broker credentials in Node.** Enqueue is an authenticated HTTP call with a
  service JWT (`aud: nova-orchestrator`).
- **Postgres is the source of truth**; Redis is only the Celery broker/result backend
  (plus optional shared agent state — see §5).
- **The orchestrator is a delegator.** Its planner menu contains at most two
  "umbrella" skills (`data.analyse.read`, `data.act.write`); all concrete business
  logic lives behind A2A agents.

---

## 2. Tech stack & dependencies

From `pyproject.toml`:

| Concern | Library |
|---|---|
| Task queue | `celery[redis] >=5.4,<6` |
| Broker / result backend | `redis >=5,<6` |
| Database | `sqlalchemy >=2`, `psycopg[binary] >=3.2` |
| HTTP gateway | `fastapi >=0.115`, `starlette`, `uvicorn[standard]` |
| HTTP client | `httpx >=0.27` |
| JWT verification | `pyjwt[crypto] >=2.9` |
| Agent-to-Agent | `a2a-sdk >=0.3,<0.4` |
| Orchestration / LLM | `langgraph >=0.2`, `langchain-core >=0.3`, `langchain-openai >=0.2` |
| Observability (optional extra `[observability]`) | `langfuse >=3,<4`, `langchain >=0.3` |
| Dev | `pytest`, `pytest-asyncio`, `mypy` (strict), `ruff` |

`pydantic` models are used throughout (gateway request bodies, LLM decisions, agent
state) via the transitive FastAPI/LangChain dependency.

---

## 3. Design: the LangGraph orchestration loop

The graph is compiled in `build_graph()` (`graph.py`) and invoked once per run inside
`run_graph()`:

```text
START → load_context → reason ─┬─► agent_dispatch ─► critique ─┐
                               │                                │
                               └─► compose ◄────────────────────┘
                                       │
                                   finalize → END
```

| Node | Function | Responsibility |
|---|---|---|
| `load_context` | fetches prompt via `ToolGatewayClient.get_prompt`, loads Redis history, emits `planner.started` / `planner.completed` |
| `reason` | `Reasoner.reason()` — LLM tool-calling over the Layer A menu, produces a `ReasonDecision` |
| `agent_dispatch` | `_run_agent_step()` — Layer B authorization gate + A2A `send_task` |
| `critique` | `Reasoner.critique()` — decides satisfied / continue |
| `compose` | `Reasoner.compose()` — writes the final answer text |
| `finalize` | `ToolGatewayClient.finalize()`, emits `run.completed`, records the conversation turn |

Routing is driven by `state["route"]` (`_route`). The `reason` node enforces several
guards before allowing another hop:

- **Step budget:** `iteration >= MAX_RUN_STEPS` → compose.
- **Explicit finish:** decision action `finish` or empty capability → compose.
- **Missing scoped inputs:** `_missing_required()` → compose (asks for clarification).
- **No-progress breaker:** a duplicate `_call_signature(capability_id, tool_input)`
  already present in `attempts` → compose.

LangGraph state (`OrchestrationState`, `dag.py`) is **in-memory only** for the
lifetime of one `invoke()` call (`run_id`, `prompt`, `history`, `iteration`, `route`,
`decision_*`, `observations`, `attempts`, `answer`, `status`, `canceled`). Durability
comes from short Postgres transactions, advisory locks, `agent_steps`, and the event
outbox — **not** from a LangGraph checkpoint store.

### Layer A menu — `_build_menu()`

The planner only ever sees **umbrella delegation skills**, never concrete tools:

- `data.analyse.read` (read umbrella)
- `data.act.write` (write umbrella, high-risk)

`mcp-tool` capabilities (agent-internal DB tools) and `delegated=True` capabilities
(concrete business skills like `sales.report.customer`) are excluded. An umbrella is
shown only if the snapshot's `capability_allowlist` actually contains entitled
underlying read/write capabilities (`_has_entitled_underlying`). Menu descriptions
prefer live Agent Card metadata (`AgentRegistry.card_skill_for()`), falling back to
`capability_guide.spec_for()`.

### Step execution — `_run_agent_step()`

Each dispatch performs, in order:

1. Advisory lock + cancel check + idempotency key
   (`agent-call:{run_id}:{capability_id}:{index}`).
2. **Layer B authorization:** `evaluate_capability(capability_id, snapshot.roles,
   has_approval=...)` (authoritative, default deny).
3. Resolve the target agent via `registry.agent_for_skill(capability_id)`.
4. Persist an `AgentStep` (`type="agent_call"`, `status="running"`), emit
   `agent.call.started`.
5. Call the agent **outside the DB transaction** via `AgentClient.send_task(...)`,
   forwarding live sub-events through a `stream_sink` callback.
6. Reconcile the terminal artifact (de-duplicating sub-events by `dedupe_key`).
7. Emit `agent.call.completed` / `agent.call.failed` and `record_audit(action="agent.invoke")`.

---

## 4. Runtime topology: gateway, worker, beat

A single Docker image runs in three modes (selected by command):

| Role | Command | Purpose |
|---|---|---|
| **Gateway** (default `CMD`) | `uvicorn nova_orchestrator.gateway:create_app --factory --port 8001` | HTTP ingress: enqueue runs, A2A agent registration |
| **Worker** | `celery -A nova_orchestrator.celery_app worker --queues=orchestrator.longrunning` | Runs the orchestration loop |
| **Webhook dispatcher** | `celery -A nova_orchestrator.celery_app worker --beat --queues=webhooks` | Beat-scheduled outbound webhook delivery |

### Gateway (`gateway.py`)

FastAPI app (`create_app()` factory) exposing:

- `GET /health`
- `POST /internal/runs` — enqueue a run; requires a JWT with `aud: nova-orchestrator`.
  Validates and dispatches `run_orchestration.apply_async(..., queue="orchestrator.longrunning")`.
- `POST /internal/agents/register` — A2A self-registration / heartbeat (azp-pinned,
  SSRF host allowlist).
- `DELETE /internal/agents/{name}` — deregister.

JWT validation uses `PyJWKClient` with algorithms `RS256` / `ES256` and requires
`exp`, `iss`, `aud`.

### Worker task flow (`tasks.py`)

`run_orchestration` (Celery task `orchestrator.run`) → `process_run()`:

1. Per-run serialization with `pg_advisory_xact_lock(hashtextextended(run_id, 0))`.
2. Idempotent on redelivery — terminal statuses
   (`completed`/`failed`/`canceled`/`expired`) short-circuit.
3. Load run + entitlement, verify the snapshot (see §6), then `run_graph()`.

Celery config (`celery_app.py`): JSON serialization, `task_acks_late=True`,
`worker_prefetch_multiplier=1`, route `orchestrator.run → orchestrator.longrunning`
and `webhook.dispatch → webhooks`, beat schedule `dispatch-due-webhooks` every 10s.

---

## 5. State model

### Persisted state — `postgres-agents` (`models.py`)

The SQLAlchemy models mirror the TypeORM tables owned by `@nova/database`:

| Model | Table | Purpose |
|---|---|---|
| `AgentRunEntitlement` | `agent_run_entitlements` | Immutable snapshot (roles, permissions, allowlist, hash, issued/expires) |
| `AgentRun` | `agent_runs` | Run lifecycle, `prompt_ref`, `conversation_id`, `cancel_requested`, heartbeat |
| `AgentRunEvent` | `agent_run_events` | Ordered outbox events (`sequence`, `type`, `payload`, `visibility`, `dedupe_key`) |
| `AgentStep` | `agent_steps` | Per-hop records (`type`, `capability`, `agent_name`, idempotency key) |
| `AgentAuditLog` | `agent_audit_log` | Immutable authorization audit |
| `WebhookAuthConfig` / `WebhookDelivery` | webhook tables | Outbox for server-to-server delivery |
| `A2aAgentRegistration` | `a2a_agent_registrations` | Dynamic agent discovery |

### Shared agent state — Redis (`agent_state.py`, optional)

Enabled via `REDIS_AGENT_URL` + `AGENT_STATE_ENABLED` (fail-soft — the run continues
if Redis is down):

| Structure | Key pattern | Writer |
|---|---|---|
| Per-run document (Hash) | `{prefix}run:{runId}:state` | Each actor owns its field |
| Conversation history (Stream) | `{prefix}conv:{conversationId}:history` | Orchestrator only |
| Conversation summary (String) | `{prefix}conv:{conversationId}:summary` | Orchestrator |

`HistoryEntry` records are owner-scoped (`owner_subject`); mismatched-owner reads are
filtered out (`_owner_matches`). `content_policy.py` further gates what text/content
is exposed based on entitlement, stripping secrets.

---

## 6. Authorization model

Authorization is **the platform's, reused — never re-implemented**. The single
source of truth is the platform database, served dynamically via the authenticated
**RBAC registry endpoint** (`GET /internal/rbac/registry`). The worker fetches the
registry at task start and publishes it as the process-wide active policy; if the
fetch fails it **fails closed** (the active registry is cleared and every
capability lookup denies). Layer B authorizes from the snapshot's effective
**permissions** against each capability's required permissions — no hardcoded
role→permission map, no codegen, no CI parity gate.

### Modules (`authz/`)

| File | Role |
|---|---|
| `rbac_registry.py` | `RbacRegistryClient` (fetch/cache by revision, ETag, fail closed) + process-wide active-registry holder |
| `registry.py` | Lookup helpers over the active registry (`permissions_for_roles`, `roles_grant_permission`, `get_capability`, …); deny when no registry is loaded |
| `policy_gate.py` | **Layer B** authoritative gate: `evaluate_capability(capability_id, permissions, …)` + reason codes |
| `snapshot.py` | `EntitlementSnapshot`, `compute_snapshot_hash`, `verify_snapshot` (byte-identical to the TS hash) |

### Snapshot verification (fail closed)

In `process_run()` the worker loads `AgentRunEntitlement`, rebuilds the
`EntitlementSnapshot`, then calls `verify_snapshot(snapshot, expected_hash=...)`. This
recomputes the canonical `sha256:` hash (fixed key order: `ownerSubject`, `roles`,
`permissions`, `capabilityAllowlist`, `issuedAtEpochS`, `expiresAtEpochS`) and checks
the stored hash, the hash enqueued by Node, and expiry. Any mismatch/expiry →
`_fail_closed()` → `authz.denied` (security visibility) + audit + run `failed`.

### Layer A vs Layer B

- **Layer A (planner filter):** the LLM only sees umbrella skills derived from the
  snapshot allowlist (`_build_menu`). The model can never widen its own toolset.
- **Layer B (authoritative):** `evaluate_capability()` runs before *every* hop and is
  default-deny (unknown capability, missing permission, or high-risk without
  approval → deny).

High-risk writes require a recorded approval; `_approval_granted()` returns `False`
unless `AGENT_WRITE_AUTO_APPROVE=true` (dev/test only, loudly logged + audited).

### Token audiences (per-hop)

| Hop | Token / audience |
|---|---|
| nova-api → gateway | `ORCHESTRATOR_AUDIENCE` (default `nova-orchestrator`) |
| worker → A2A agent | `ServiceTokenClient.get_token(audience_scope)` (e.g. `nova-agent-sql-analyst`) |
| agent → orchestrator (registration) | orchestrator-audience token with `azp ∈ AGENT_REGISTRATION_AUTHORIZED_PARTIES` |

`WORKER_REQUEST_AUDIENCE_SCOPES` controls whether the audience is requested as an
OAuth `scope` (true) or via realm protocol mappers (false, default).

---

## 7. Events & webhooks

### Event outbox (`events.py`)

Events have one of three **visibilities**: `user`, `internal`, `security`.

- **Browser SSE** (served by Node): exposes `visibility = 'user'` by default; owners
  can opt into `internal`/`security` with `detail=full`.
- **Webhooks:** enqueued in the **same DB transaction** as the event
  (`emit_event()` → `enqueue_webhook_if_configured()`), a transactional outbox.

Helpers: `safe_io()` (secret redaction + size bounds on persisted payloads),
`agent_event_visibility()` (classifies forwarded agent sub-events), `record_audit()`,
`set_run_status()`, `next_sequence()`. Emitted types include `authz.allowed`,
`authz.denied`, `run.accepted/started/completed/canceled`, `planner.started/completed`,
and `agent.call.started/completed/failed`, plus forwarded agent sub-events.

### Webhook dispatcher (`webhooks.py`, `webhook_tasks.py`)

Webhooks are **never sent from the orchestration task**. A separate Celery beat task
`webhook.dispatch` runs every 10s:

- `dispatch_due()` claims `WebhookDelivery` rows with `FOR UPDATE SKIP LOCKED`.
- Deliveries are **coalesced** by `(destination_url, auth_config_id)` into a batched
  POST (`schemaVersion: 2`, `events[]`).
- Bodies are HMAC-signed (`v1:{timestamp}:{batchId}:{sha256(rawBody)}`,
  header `X-Nova-Signature`).
- Retries follow `BACKOFF_SCHEDULE_S = (0, 10, 30, 120, 600, 1800, 7200)` then
  dead-letter. Secrets resolve from `WEBHOOK_SECRET__*` / `WEBHOOK_HMAC_SECRET`.

---

## 8. Observability (`observability/langfuse_tracing.py`)

Optional and **fail-soft**: active when `LANGFUSE_TRACING_ENABLED` is truthy and
`LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` are set.

- `run_trace()` opens a root span per run (`user_id=owner_subject`,
  `session_id=conversation_id`); `trace_id_for(run_id)` derives a deterministic trace
  id so the agent's spans join the same trace.
- `make_callback_handler()` provides a LangChain callback for LangGraph/LLM nesting;
  `tool_span()` wraps A2A hops; `flush()` runs at the end of `run_graph()`.
- **PII scrubbing (`mask()`):** redacts credential-like keys, Bearer tokens, JWTs, and
  provider API keys, with depth/size bounds (`_MAX_STRING=2000`, `_MAX_DEPTH=8`,
  `_MAX_ITEMS=200`). Trace ids are forwarded to agents via the A2A payload
  (`langfuseTraceId`, `langfuseParentObservationId`).

---

## 9. Configuration (`config.py`)

`load_config()` produces a typed `OrchestratorConfig` and fails fast on invalid env.
Selected variables (see source for the full set):

| Env var | Default | Purpose |
|---|---|---|
| `ORCHESTRATOR_ROLE` | `worker` | `gateway` vs `worker` |
| `CELERY_BROKER_URL` | **required** | Redis broker |
| `CELERY_RESULT_BACKEND` | **required** | Redis result backend |
| `AGENTS_DATABASE_URL` | **required** | `postgres-agents` SQLAlchemy URL |
| `KEYCLOAK_ISSUER_URL` | **required** | JWT issuer |
| `KEYCLOAK_JWKS_URI` / `KEYCLOAK_TOKEN_URL` | derived | JWKS / token endpoints |
| `ORCHESTRATOR_AUDIENCE` | `nova-orchestrator` | Gateway JWT audience |
| `WORKER_CLIENT_ID` / `WORKER_CLIENT_SECRET` | `nova-celery-worker` / `""` | OAuth client for outbound tokens |
| `WORKER_REQUEST_AUDIENCE_SCOPES` | `false` | Request audience as OAuth scope |
| `AGENT_WRITE_AUTO_APPROVE` | `false` | Dev/test bypass of the high-risk approval gate |
| `MAX_RUN_STEPS` | `30` | Graph iteration budget |
| `RUN_SOFT_TIME_LIMIT_S` / `RUN_TIME_LIMIT_S` | `6900` / `7200` | Celery time limits |
| `NOVA_API_INTERNAL_URL` | `http://nova-api:3000` | Tool gateway base |
| `SQL_ANALYST_AGENT_URL` | `http://at-sql-analyser:8003` | Registry seed |
| `SQL_ANALYST_AGENT_AUDIENCE` | `nova-agent-sql-analyst` | Seed audience |
| `A2A_REGISTRY_TTL_SECONDS` | `120` | Live registration TTL |
| `AGENT_REGISTRATION_AUTHORIZED_PARTIES` | `nova-agent-sql-analyst` | azp allowlist (CSV) |
| `AGENT_REGISTRATION_ALLOWED_HOSTS` | `""` | SSRF host allowlist |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | `""` / `None` | LLM credentials |
| `LLM_MODEL` / `LLM_TEMPERATURE` / `LLM_TIMEOUT_S` | `kimi-2.6` / `0.0` / `30.0` | LLM config |
| `REDIS_AGENT_URL` / `AGENT_STATE_ENABLED` | `None` / `true` | Shared state store |
| `AGENT_STATE_KEY_PREFIX` | `nova:agent:` | Redis key prefix |
| `LANGFUSE_*` | — | Tracing (see §8) |

---

## 10. Agent registry & selection

Agent *selection* is a registry lookup, not an LLM decision:

- `load_registry_from_store()` reads `a2a_agent_registrations` where
  `last_seen_at >= now - A2A_REGISTRY_TTL_SECONDS`; advertised skills are validated
  against the active RBAC registry (`kind == "agent-skill"`).
- When the registry is empty, a static SQL-analyst seed is used
  (`A2A_REGISTRY_SEED_SQL_ANALYST`, `SQL_ANALYST_AGENT_URL`, `SQL_ANALYST_AGENT_AUDIENCE`).
- `AgentRegistry.agent_for_skill(capability_id)` maps an umbrella skill to a concrete
  agent descriptor.

`AgentClient.send_task()` (`agent_client.py`) resolves the agent's Agent Card via
`A2ACardResolver`, mints a scope-restricted token, sends a `Message` containing a
`DataPart` (`runId`, `skillId`, `goal`, `intent`, `approvalGranted`, `conversationId`,
Langfuse trace ids) plus a `TextPart`, streams sub-events when the card advertises
streaming, and parses the `AgentTaskResult`.

---

## 11. Tests

`pytest` from this directory (source on the `src` pythonpath). Coverage is heavy at
the unit level (no full end-to-end run):

| File | Focus |
|---|---|
| `test_graph.py` | Menu building, dedupe keys, dispatch routing, approval/auto-approve, history |
| `test_agents.py` | `AgentRegistry`, store loading, SSRF guards, card parsing, seed fallback |
| `test_agent_client.py` | A2A result parsing, event coercion, 401 token invalidation |
| `test_policy_gate.py` | Layer B allow/deny/unknown/missing-permission, fail-closed when no registry loaded |
| `test_snapshot_parity.py` | Cross-language hash parity, tamper/expiry |
| `test_events.py` | `safe_io`, visibility classifier, webhook enqueue scoping |
| `test_webhooks.py` | HMAC signing, batch body, backoff, dead-letter |
| `test_gateway.py` | Registration auth, SSRF, upsert/deregister |
| `test_tokens.py` | Audience scope modes, per-audience cache |
| `test_prompts.py` | Prompt rendering, tool parsing, delegation policy |
| `test_content_policy.py` | Entitlement-gated Redis content |
| `test_agent_state.py` | Redis isolation, owner mismatch, fail-soft |
| `test_observability.py` | Langfuse fail-soft spans |

---

## 12. File map

| Path | Description |
|---|---|
| `src/nova_orchestrator/config.py` | Typed config + `load_config()` |
| `src/nova_orchestrator/celery_app.py` | Celery app, queues, beat schedule |
| `src/nova_orchestrator/tasks.py` | `process_run()` + `run_orchestration` task, snapshot gate |
| `src/nova_orchestrator/graph.py` | LangGraph build/run, `_run_agent_step()`, menu/finalize |
| `src/nova_orchestrator/dag.py` | `MenuItem`, `Observation`, `OrchestrationState` |
| `src/nova_orchestrator/gateway.py` | FastAPI gateway (enqueue, agent registration) |
| `src/nova_orchestrator/tool_gateway.py` | `ToolGatewayClient` (prompt fetch + finalize) |
| `src/nova_orchestrator/agent_client.py` | `AgentClient` — A2A outbound tasks + streaming |
| `src/nova_orchestrator/agents.py` | `AgentRegistry`, store loading + seed |
| `src/nova_orchestrator/llm.py` | `Reasoner`, `OpenAIReasoner`, tool parsing |
| `src/nova_orchestrator/prompts.py` | System/user prompts for the graph nodes |
| `src/nova_orchestrator/capability_guide.py` | Umbrella tool specs |
| `src/nova_orchestrator/content_policy.py` | Entitlement-gated content for shared state |
| `src/nova_orchestrator/agent_state.py` | Redis run state + conversation history |
| `src/nova_orchestrator/models.py` | SQLAlchemy models for `postgres-agents` |
| `src/nova_orchestrator/db.py` | Lazy SQLAlchemy engine/session factory |
| `src/nova_orchestrator/events.py` | Transactional outbox, audit, webhook enqueue |
| `src/nova_orchestrator/webhooks.py` | Outbox dispatcher (coalescing, HMAC, backoff) |
| `src/nova_orchestrator/webhook_tasks.py` | Celery `webhook.dispatch` task |
| `src/nova_orchestrator/tokens.py` | `ServiceTokenClient` (client-credentials + cache) |
| `src/nova_orchestrator/authz/*.py` | Dynamic RBAC registry client + Layer B gate + snapshot integrity |
| `src/nova_orchestrator/observability/langfuse_tracing.py` | Langfuse v3 wiring + masking |
| `Dockerfile` | Single image for gateway + workers |
| `tests/*.py` | Unit tests (see §11) |

---

## 13. Local development

```bash
# from agents/orchestrator/
uv sync                       # or: pip install -e .[observability]
ruff check .
mypy .
pytest
```

In Docker, the service is started by the root `docker-compose.yml` in its three roles
(gateway, worker, webhook beat). The worker depends on Redis, `postgres-agents`,
Keycloak, and the Node tool gateway being reachable.

---

## 14. Keycloak usage (validated against the code)

Keycloak is the platform's identity provider. The orchestrator never sees a user
login — it only handles **service-to-service** tokens — but it both **verifies** inbound
tokens and **mints** outbound ones against Keycloak.

### Inbound verification (gateway)

`gateway.py` `require_service_token` validates the `nova-api` service token on
`POST /internal/runs` and the agent-registration routes:

- JWKS-based signature verification with `jwt.PyJWKClient(cfg.keycloak_jwks_uri)`.
- `jwt.decode(..., algorithms=["RS256","ES256"], audience=cfg.orchestrator_audience,
  issuer=cfg.keycloak_issuer_url, options={"require": ["exp","iss","aud"]})`.
- Any `PyJWTError` (invalid/expired/wrong-audience/wrong-issuer) → `401`.
- `require_agent_registrar` additionally **pins `azp`** to
  `AGENT_REGISTRATION_AUTHORIZED_PARTIES` (default `nova-agent-sql-analyst`) → `403`
  otherwise.

The orchestrator does **not** verify end-user tokens (it has no user-facing routes).

### Outbound minting (worker)

`tokens.py` `ServiceTokenClient` performs the OAuth2 **`client_credentials`** grant
against Keycloak's token endpoint (`KEYCLOAK_TOKEN_URL`) using `WORKER_CLIENT_ID` /
`WORKER_CLIENT_SECRET`. Tokens are minted **per target audience** (e.g.
`nova-agent-sql-analyst`), cached per audience, and never logged. When
`WORKER_REQUEST_AUDIENCE_SCOPES=true` the audience is forwarded as an OAuth `scope`
(decision D5 — single-audience tokens); when `false` (default) the realm injects the
audience via protocol mappers and `azp` pinning at each resource server is the
authoritative control.

### Configuration

`KEYCLOAK_ISSUER_URL` is **required**; `KEYCLOAK_JWKS_URI` and `KEYCLOAK_TOKEN_URL` are
derived from it when not explicitly set. Snapshot integrity is enforced by the
canonical hash (§6), **not** by Keycloak — Keycloak only authenticates the transport
hop. Files: `gateway.py` (verify), `tokens.py` (mint), `config.py` (URLs/audiences).
