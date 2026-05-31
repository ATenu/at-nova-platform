# Nova Orchestrator (execution plane)

Python execution plane for secure, asynchronous A2A agent orchestration. One
image runs in two roles:

- **`gateway`** — FastAPI ([`gateway.py`](src/nova_orchestrator/gateway.py)).
  The Node control plane (`@nova/api`) calls it with a service token
  (`aud: nova-orchestrator`); the gateway validates the token against Keycloak
  JWKS and enqueues the Celery task **by ID only**. No prompt, secret, or user
  token ever crosses this boundary.
- **`worker`** — Celery ([`celery_app.py`](src/nova_orchestrator/celery_app.py),
  [`tasks.py`](src/nova_orchestrator/tasks.py)). Loads the run + entitlement
  snapshot from `postgres-agents`, **verifies the snapshot hash and expiry
  (fail closed)**, runs the default-deny policy gate before every hop, and
  writes each state transition with its outbox event in one transaction.
- **`celery-webhook`** — webhook dispatcher
  ([`webhooks.py`](src/nova_orchestrator/webhooks.py),
  [`webhook_tasks.py`](src/nova_orchestrator/webhook_tasks.py)). A beat-scheduled
  poller drains the `webhook_deliveries` outbox, signs each body (HMAC over
  `v1:{ts}:{eventId}:{sha256(body)}`), POSTs over HTTPS, and retries with
  exponential backoff until `succeeded` or `dead_letter`.

## Orchestration graph & the MCP tool gateway

The worker never touches the business `nova` database. The graph
([`graph.py`](src/nova_orchestrator/graph.py)) plans with a deterministic,
allow-list-constrained planner ([`planner.py`](src/nova_orchestrator/planner.py)),
then for each hop: runs Layer B, calls back into the **Node-hosted MCP tool
gateway** (`/internal/agent-runs/:runId/...`) with an audience-restricted
(`nova-mcp-*`) service token, and persists the step + events + audit. The Node
gateway independently re-verifies the entitlement snapshot and re-enforces the
capability against it (defense in depth) before running the existing,
permission-gated business service. Each step runs in its own short transaction
so progress streams live; steps carry an idempotency key so Celery retries /
worker restarts never double-execute. A LangGraph + LLM planner is a drop-in
replacement for `planner.py` — the authoritative gate re-checks every hop
regardless of how the plan was produced.

## Security model

- **Entitlement snapshot integrity** ([`authz/snapshot.py`](src/nova_orchestrator/authz/snapshot.py)).
  The canonical hash is byte-identical to the TypeScript implementation in
  `backend-services/api/src/modules/agent-runs/entitlement-snapshot.ts`. The
  pinned cross-language vector is asserted in both
  [`tests/test_snapshot_parity.py`](tests/test_snapshot_parity.py) and the
  matching Jest test.
- **Two-layer authorization** ([`authz/policy_gate.py`](src/nova_orchestrator/authz/policy_gate.py)).
  Layer A hands the planner only the capabilities the snapshot allows; Layer B
  is the authoritative, default-deny gate run before every agent/tool hop. The
  LLM can never widen the allowlist — a prompt-injected "use tool X" still hits
  the gate and is denied if the user lacks the permission.
- **RBAC parity** ([`authz/nova_authz.py`](src/nova_orchestrator/authz/nova_authz.py)).
  Generated from the TypeScript registry; never hand-edited.

## RBAC parity is generated, not duplicated

```bash
# 1. Export the canonical registry from @nova/shared (TypeScript = source of truth)
cd backend-services && npm run -w @nova/shared rbac:export

# 2. Regenerate the Python mirror
cd services/orchestrator && python scripts/generate_nova_authz.py
```

CI must run both steps and fail on any diff so the two sides cannot drift.

## Local development

```bash
python -m venv .venv && . .venv/Scripts/activate   # PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"

pytest -q          # unit tests (snapshot parity, policy gate, registry)
ruff check src tests
mypy src
```

The whole stack (Redis broker, `postgres-agents`, gateway, worker) comes up via
the repo-root `docker-compose.yml`.

## Configuration

All configuration is read once, fail-fast, in
[`config.py`](src/nova_orchestrator/config.py). Required: `KEYCLOAK_ISSUER_URL`,
`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `AGENTS_DATABASE_URL`. The worker
also uses `NOVA_API_INTERNAL_URL` (MCP tool gateway), `WORKER_CLIENT_SECRET`
(per-hop token minting), and `MAX_RUN_STEPS` (per-run budget). Secrets are never
logged.

## Production hardening deferred (needs external infrastructure)

The secure functional pipeline runs end to end locally. The following plan items
are intentionally left as integration points because they require infrastructure
not present in local dev, and are documented rather than stubbed insecurely:

- **OpenTelemetry traces / Langfuse dashboards** (section 20): correlation/request
  IDs already propagate; wiring exporters needs a collector + Langfuse server.
- **mTLS service mesh and Keycloak Token Exchange** (sections 9.4, 22): additive
  defense-in-depth on top of the authoritative snapshot enforcement.
- **Managed secret store** for webhook HMAC/bearer secrets (section 16): the
  schema stores only `*_secret_ref` references; `webhooks.resolve_secret` reads
  dev values from env and is the single place to swap in a KV client.
- **Standalone A2A agent / MCP server processes** (section 11): today the MCP
  tools are realized as the Node-hosted tool gateway (which the plan explicitly
  permits for early phases); promoting them to separate resource servers reuses
  the same `nova_authz` parity package and audience-restricted tokens.
