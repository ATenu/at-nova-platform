# Nova Implementation Plan: Secure Asynchronous A2A Agent Orchestration with Celery, Keycloak, Node.js, and React

> Revision note: this plan was re-aligned with the actual Nova codebase and its
> non-negotiable security rules. The original draft assumed a generic
> multi-tenant SaaS with ad hoc OAuth scopes and a cloud secrets manager. Nova
> is currently **single-tenant**, uses **Keycloak realm roles** with a
> **centralized, code-owned permission registry** (`@nova/shared`), and a
> **centralized typed route-policy pipeline**. Every change below reuses those
> existing patterns instead of inventing parallel ones. Authorization is never a
> frontend or LLM decision; it is enforced in code, default-deny, at every trust
> boundary.

## 1. Target outcome

Build a secure, fully asynchronous orchestration layer that lets the React app
submit long-running agent requests through the existing strongly typed Node.js
backend (`@nova/api`), dispatch orchestration work to Celery workers, coordinate
multiple A2A agents and MCP tool servers, publish intermediate progress events,
and deliver final results through frontend streaming and/or secured webhooks.

The platform must support:

* Long-running multi-agent execution triggered from the existing chat surface
  (`POST /api/v1/a2a/chat`, persisted as `conversations` / `messages`).
* Intermediate updates: step started/completed, tool called/completed, agent
  delegated, artifact generated, error, retry, final response.
* Durable state recovery after a worker crash or deployment.
* **Per-user, per-capability authorization** that is enforced again inside every
  A2A agent and every MCP tool server, not just at the API edge.
* Bearer-token secured webhooks with replay protection and idempotency.
* Full auditability and enterprise observability (OpenTelemetry + Langfuse).
* No secrets, tokens, or PII in broker messages, logs, traces, or prompts.

### 1.1 Identity model: single-tenant today, ownership by Keycloak subject

Nova has no `tenantId` today. Ownership and isolation are keyed by the Keycloak
**subject** (`sub`) and the corresponding `users.id` row. Capability is governed
by **realm roles** (`admin`, `sales-user`, `support-operations-user`,
`customer-support`, `ops-compliance`) mapped to **domain permissions** in
`backend-services/packages/shared/src/rbac/permissions.ts`.

Wherever the original draft said `tenantId`, this plan uses `ownerSubject`
(Keycloak `sub`) plus `ownerUserId` (`users.id`). A nullable `orgId` column is
included only as forward-compatible scaffolding for future multi-tenancy; it
must default to a single well-known value and must not be trusted from the
client. Do not introduce a tenant concept into runtime authorization until the
platform actually becomes multi-tenant.

## 2. High-level architecture

The Node.js backend is the **control plane**. The Celery orchestration service
is the **execution plane**. Keycloak is the single identity provider for both
human users and service-to-service calls.

```text
React Frontend (nova-frontend, public client, OIDC + PKCE)
   |
   | user access token (aud: nova-api)
   v
Node.js Backend API  (nova-api, confidential client)        [CONTROL PLANE]
   |  - validates user token (jose JWKS, iss/aud/exp/nbf, RS256/ES256)
   |  - builds typed AuthContext + permission set (@nova/shared)
   |  - authorizes via centralized route-policy registry (default deny)
   |  - creates agent_run + immutable entitlement snapshot (postgres-agents)
   |  - enqueues by ID only (no token/prompt/secret in the message)
   |
   | client_credentials service token (aud: nova-orchestrator)
   v
Orchestrator API / Task Gateway  (nova-orchestrator, confidential client)
   |  - validates the nova-api service token (aud: nova-orchestrator)
   |  - writes orchestration metadata, enqueues Celery task
   v
redis-orchestrator  (dedicated Celery broker + result backend)
   |
   v
Celery Orchestrator Workers  (nova-celery-worker, confidential client)  [EXEC PLANE]
   |  - loads run + entitlement snapshot from postgres-agents
   |  - runs the orchestration graph; a CODE policy gate authorizes every hop
   |
   +--> A2A Agent Adapter  -> Agents (aud: nova-agent-*)   [re-enforce authz]
   +--> MCP Tool Gateway   -> MCP servers (aud: nova-mcp-*) [re-enforce authz]
   +--> Durable State Store -> postgres-agents (source of truth + outbox)
   |
   v
Webhook Dispatcher (transactional outbox) --signed HTTPS--> receiver
   |
   v
Node callback -> Redis pub/sub -> SSE/WebSocket -> React
```

Two security properties to preserve throughout:

1. **No raw user token crosses into the execution plane.** Long-running tasks
   outlive short-lived user tokens, so the user token is never persisted or put
   on the broker. Authorization travels as an immutable, integrity-checked
   **entitlement snapshot** plus per-hop **audience-restricted service tokens**.
2. **Every executor re-enforces authorization.** A valid Nova service token
   only proves "a trusted Nova service is calling". Each agent and MCP server
   independently checks the acting user's capability against the snapshot and
   fails closed if it is missing, expired, or tampered.

## 3. Core design principle

Do not rely on Celery's result backend as the source of truth. Use Celery to
execute work; use **`postgres-agents`** (a dedicated database, see section 6) as
the durable transactional store for run/step/agent-call/tool-call state, the
event outbox, webhook delivery state, idempotency keys, audit logs, entitlement
snapshots, and final artifacts.

Celery tasks are **idempotent, resumable workers**, not the only place where
orchestration memory exists.

## 4. Main components (mapped to the existing repo)

### 4.1 React frontend (`frontend/web`, `nova-frontend`)

* Already authenticates via OIDC authorization-code + PKCE (`nova-frontend`
  public client, `nova-api` audience mapper).
* Submits agent requests to `@nova/api`. Shows immediate run status.
* Receives progress via SSE/WebSocket from `@nova/api` (preferred) or polling.
* Never calls Celery, the broker, agents, or MCP servers directly. Never stores
  webhook secrets or service tokens. Frontend authorization only hides UI; it is
  never a security control.

### 4.2 Node.js backend (`@nova/api`) — control plane

Reuse, do not replace, the existing pipeline:
`authenticate` (`TokenVerifier`) -> `authorize(defineRoutePolicy(...))` ->
`validateRequest` (Zod) -> controller (thin) -> service -> repository.

New module `modules/agent-runs/` following the existing module shape
(`*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.schema.ts`,
`*.repository.ts`, `*.dto.ts`). Responsibilities:

* Validate user identity and resolve the app user (`resolveCurrentUser`).
* Authorize via new typed permissions (section 5.3) and route policies.
* Validate request schema with Zod.
* Create the `agent_runs` row and the immutable **entitlement snapshot**.
* Mint a `nova-orchestrator`-audience service token and call the Orchestrator
  API (or enqueue directly in Phase 1) with IDs only.
* Expose run status, event stream, artifact read, and cancel endpoints.
* Receive internal webhook callbacks and fan out to React over SSE/WebSocket.

The existing synchronous `AgentGateway` (`LocalAgentGateway`) evolves into an
**async submission gateway**: `respond()` is replaced by `submitRun()` returning
a `runId`, plus an event subscription. The conversation/message persistence
(`ConversationRepository`, `messages.is_mcp_apps` / `mcp_app_link`) is reused to
store the final assistant message and tool deep links.

### 4.3 Orchestrator API / Task Gateway (`nova-orchestrator`)

A dedicated Python (FastAPI) service colocated with Celery. It exists so the
Node API never needs broker credentials.

* Validates the inbound `nova-api` service token (issuer, `aud: nova-orchestrator`,
  `exp`, `nbf`, `alg`, signature) against Keycloak JWKS.
* Validates that the run exists and is in `queued`.
* Enqueues the Celery task onto `redis-orchestrator`.
* In Phase 1 this may be folded into the worker entrypoint; promote it to a
  separate service before exposing broker access more widely.

### 4.4 Celery orchestrator workers (`nova-celery-worker`) — execution plane

* Load the run and entitlement snapshot from `postgres-agents`.
* Execute the orchestration graph (LangGraph) step by step.
* Run the **code policy gate** before every agent/tool call (section 9).
* Mint per-hop, audience-restricted service tokens (`nova-agent-*`,
  `nova-mcp-*`) via `client_credentials`.
* Persist each state transition; emit progress events into the outbox.
* Retry safely on transient failures; mark terminal status explicitly.
* Never log secrets or place them in task payloads, prompts, or Langfuse traces.

The Celery payload contains only stable identifiers:

```json
{
  "runId": "run_...",
  "requestId": "req_...",
  "idempotencyKey": "idem_...",
  "actingSubject": "kc-sub-...",
  "entitlementSnapshotId": "ent_...",
  "entitlementSnapshotHash": "sha256-..."
}
```

`actingSubject` is a routing/diagnostic hint only. Authorization decisions are
made from the integrity-checked snapshot loaded from `postgres-agents`, never
from fields trusted off the wire. Do not put prompts, documents, credentials,
bearer tokens, or webhook secrets in the broker message.

## 5. Identity, Keycloak, and centralized RBAC

This section replaces the original draft's ad hoc `orchestrator.runs.*` OAuth
scopes. Nova keeps **roles in Keycloak** and **permissions in code**.

### 5.1 New Keycloak clients (add to `infra/keycloak/nova-realm.dev.json`)

All are confidential, `serviceAccountsEnabled: true`, `standardFlowEnabled:
false`, `directAccessGrantsEnabled: false`, mirroring the existing `nova-api`
client. Each is the OAuth client identity of exactly one service (least
privilege, separate credentials):

| Client ID            | Purpose                          | Token audience(s) it requests        |
| -------------------- | -------------------------------- | ------------------------------------- |
| `nova-orchestrator`  | Task gateway                     | consumes `nova-orchestrator`          |
| `nova-celery-worker` | Orchestration workers            | requests `nova-agent-*`, `nova-mcp-*` |
| `nova-agent-<name>`  | Each A2A agent (resource server) | consumes `nova-agent-<name>`          |
| `nova-mcp-<name>`    | Each MCP server (resource server)| consumes `nova-mcp-<name>`            |

Use **audience protocol mappers** so a token minted for one agent/MCP cannot be
replayed against another (per-resource audience isolation). Keep secrets out of
the committed realm file for any non-local environment; the dev file may carry a
dev-only secret exactly as `nova-api` does today, and it must be rotated per
environment.

Reuse the existing `client_credentials` + token-cache pattern from
`backend-services/api/src/auth/keycloak-admin-client.ts` for every service that
needs to mint a token. Do not write a second token client; extract a shared
`ServiceTokenClient` if more than one consumer appears.

### 5.2 Realm roles stay authoritative for capability

No new realm roles are required for the core flow. The five existing roles plus
the code-owned `ROLE_PERMISSIONS` map remain the single source of truth. If a
future capability needs a coarse gate not expressible by existing permissions,
add a permission to the registry first; only add a Keycloak role when the human
org model genuinely needs one.

### 5.3 New permissions are run-lifecycle plumbing only

Add to `PERMISSIONS` and `ROLE_PERMISSIONS` in
`backend-services/packages/shared/src/rbac/permissions.ts` (and the DB seed,
which already consumes the same constants):

```ts
// New permissions — these gate the RUN LIFECYCLE API, not domain actions.
'create-agent-run',   // may open a run at all (coarse feature gate / kill switch)
'read-agent-run',     // may read/stream a run they own
'cancel-agent-run',   // may cancel a run they own
```

Grant all three to every human role allowed to use the assistant
(`sales-user`, `support-operations-user`, `customer-support`, `ops-compliance`,
`admin`). They protect the `/api/v1/agent-runs` surface (start, read own run,
cancel own run) and nothing more.

**These do not provide granular security**, and that is intentional. They must
never be the gate that decides whether a user may "add a sale" or "mark an
action completed." That decision is made by binding each **agent skill** to the
**existing domain permissions** the equivalent business operation already
requires (section 5.5). A user with `create-agent-run` but without `write-sales`
can open a run and chat, but the "add a sale" skill is invisible to the planner
and rejected by the code gate. No privilege is ever escalated through the agent.

### 5.4 Python parity of the permission registry

A2A agents and MCP servers are Python and must enforce the *identical* mapping.
Introduce a small generated/shared Python module `nova_authz` that mirrors
`PERMISSIONS`, `ROLES`, and `ROLE_PERMISSIONS`. To prevent drift:

* Treat the TypeScript `@nova/shared` registry as the source of truth.
* Generate the Python constants from it in CI (a small codegen step) and fail
  the build if the generated file is out of date.
* Both sides expose the same helpers: `permissions_for_roles(roles)` and
  `roles_grant_permission(roles, permission)`.

### 5.5 Skill authorization: bind every agent skill to existing permissions

This is the linchpin that answers "can *this* user request *this* service?", at
the granularity of an individual agentic action (provide a sales report, add a
sale, list a customer's pending issues, get the next action, mark an action
completed, ...). It deliberately introduces **no new roles**. Instead, every
A2A agent **skill** and every MCP **tool** (collectively, a *capability*)
declares the **existing domain permission(s)** it requires — the *same*
permission the equivalent REST route already enforces today.

A capability descriptor is typed data on both sides (`@nova/shared` and the
Python `nova_authz` parity package):

```ts
interface CapabilityDescriptor {
  readonly id: string;                              // e.g. 'sales.report.customer'
  readonly kind: 'agent-skill' | 'mcp-tool';
  readonly mode: 'read' | 'write';                  // intent classification
  readonly requiredPermissions: readonly Permission[]; // ALL required (AND)
  readonly risk: 'low' | 'high';                    // 'high' adds approval gate (s.18)
  readonly resourceScoped: boolean;                 // true => record-level check at the tool
}
```

Authorization is **AND-composed**: a user may invoke the capability only if their
snapshot permission set contains **every** entry in `requiredPermissions`. A
capability with no descriptor is unreachable (default deny). Adding a skill
requires adding its descriptor and tests.

#### Single source of truth: reuse the route policies you already have

The Node REST API already gates each business operation with exactly the right
permission via `defineRoutePolicy` (e.g. `GET /sales` needs `read-sales`,
`POST /sales` needs `write-sales`, the action update route needs `write-actions`).
The cleanest, least-drift design is therefore:

1. **Implement MCP tools as thin callers of those existing, permission-gated
   API operations** (or share the same service layer). The authorization is then
   literally the API's own authorization — reused, not re-implemented.
2. Set each capability's `requiredPermissions` to the **same** permission its
   underlying route requires, and add a contract test that fails if a
   capability's `requiredPermissions` diverges from the route policy of the
   operation it wraps. One mapping, enforced in three places (planner filter,
   worker gate, MCP server), can never drift from the REST contract.

#### The example skills, mapped to existing permissions

| Agent skill (capability id)        | Action                                  | requiredPermissions (existing)   | mode  |
| ---------------------------------- | --------------------------------------- | -------------------------------- | ----- |
| `sales.report.customer`            | Provide a customer sales report         | `read-sales` + `read-customers`  | read  |
| `sales.create`                     | Add a new sale                          | `write-sales`                    | write |
| `issues.list.pendingForCustomer`   | Which issues are pending for customer X | `read-issues` + `read-customers` | read  |
| `actions.next`                     | What is the next action                 | `read-actions`                   | read  |
| `actions.markCompleted`            | Mark an action as completed             | `write-actions`                  | write |
| `issues.create`                    | Open a new issue                        | `create-issues`                  | write |
| `sop.read`                         | Read an SOP                             | `read-sop`                       | read  |

#### How this already gives per-user granularity (using current `ROLE_PERMISSIONS`)

| Skill                       | sales-user | support-operations-user | customer-support | ops-compliance | admin |
| --------------------------- | :--------: | :---------------------: | :--------------: | :------------: | :---: |
| `sales.report.customer`     |     ✓      |            ✓            |        ✓         |       ✗        |   ✓   |
| `sales.create`              |     ✓      |            ✗            |        ✗         |       ✗        |   ✓   |
| `issues.list.pendingForCustomer` | ✓     |            ✓            |        ✓         |       ✗        |   ✓   |
| `actions.next`              |     ✓      |            ✓            |        ✓         |       ✗        |   ✓   |
| `actions.markCompleted`     |     ✗      |            ✓            |        ✓         |       ✗        |   ✓   |

So a sales user can pull reports and add sales but **cannot** mark actions
completed; an operations/support user can manage issues and actions but
**cannot** add a sale; a compliance user gets only the SOP skills. The same
chat request ("add this sale") yields a usable skill for one role and a
default-deny for another — without any agent-specific role.

#### "The same action may be modified depending on the user"

Two mechanisms cover this, both data-driven, neither relying on the LLM:

1. **Read/write down-scoping.** When a user holds the read permission but not the
   write permission for a resource, only `mode: 'read'` capabilities for that
   resource are offered. The agent can *report* on sales but the "add sale" skill
   is absent for that user.
2. **Record-level / field-level scoping (`resourceScoped: true`).** Whether a
   user may act on *customer X specifically*, and which fields are returned, is
   enforced at the MCP tool / API layer that owns the data (the same place the
   REST API enforces it today), and sensitive fields are redacted before they
   reach the model. The orchestrator passes identity context; it never decides
   record-level access itself.

High-risk capabilities (`risk: 'high'`) additionally require the human approval
gate in section 18, regardless of permission.

## 6. Persistence: dedicated `postgres-agents` + `redis-orchestrator`

### 6.1 Why a separate database (data-plane segregation)

The orchestration plane gets its **own** PostgreSQL instance/database,
`postgres-agents`, with its own credentials. It is **not** granted access to the
business `nova` database. Consequences:

* The execution plane cannot bypass authorization by reading business tables
  directly. All business reads/writes go through MCP tools or the Node API,
  which enforce per-user permissions.
* A compromise of a worker or agent cannot directly exfiltrate `customers`,
  `sales`, `issues`, etc.
* Orchestration retention/PII policies are managed independently of core data.

### 6.2 `postgres-agents` schema (snake_case, TypeORM/SQLAlchemy)

Note the differences from the original draft: `tenant_id` is replaced by
`owner_subject` + `owner_user_id`; an `agent_run_entitlements` snapshot table and
an `agent_audit_log` table are added.

```sql
agent_runs (
  id uuid primary key,
  owner_subject text not null,           -- Keycloak sub
  owner_user_id uuid not null,           -- nova users.id
  org_id uuid not null default '00000000-0000-0000-0000-000000000000',
  conversation_id uuid,                  -- links to nova conversations.id (logical, cross-db)
  status text not null,
  prompt_ref text not null,              -- reference to encrypted object storage, not the prompt
  response_ref text,
  callback_auth_config_id uuid,
  entitlement_snapshot_id uuid not null references agent_run_entitlements(id),
  idempotency_key text not null,
  cancel_requested boolean not null default false,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz,
  unique (owner_subject, idempotency_key)
);

-- Immutable authorization snapshot captured at submission by the Node API.
agent_run_entitlements (
  id uuid primary key,
  owner_subject text not null,
  owner_user_id uuid not null,
  roles jsonb not null,                  -- realm roles at submission time
  permissions jsonb not null,            -- derived permission set (@nova/shared)
  capability_allowlist jsonb not null,   -- capabilities resolved from permissions
  snapshot_hash text not null,           -- sha256 over canonical payload
  issued_at timestamptz not null,
  expires_at timestamptz not null        -- bounds how long an async run may act
);

agent_run_events (
  id uuid primary key,
  run_id uuid not null references agent_runs(id),
  owner_subject text not null,
  sequence bigint not null,              -- monotonic per run
  type text not null,
  payload jsonb not null,
  visibility text not null,              -- user | internal | security
  created_at timestamptz not null,
  unique (run_id, sequence)
);

agent_steps (
  id uuid primary key,
  run_id uuid not null references agent_runs(id),
  parent_step_id uuid,
  type text not null,                    -- planner | agent_call | tool_call | join
  status text not null,
  capability text,                       -- catalog key (section 5.5)
  required_permission text,              -- resolved permission gate
  agent_name text,
  tool_name text,
  external_task_id text,                 -- A2A task id mapping
  input_ref text,
  output_ref text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text
);

webhook_deliveries (
  id uuid primary key,
  run_id uuid not null references agent_runs(id),
  event_id uuid not null references agent_run_events(id),
  owner_subject text not null,
  destination_url text not null,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  delivered_at timestamptz
);

webhook_auth_configs (
  id uuid primary key,
  owner_subject text not null,
  auth_type text not null,
  token_secret_ref text,                 -- reference only; never the secret
  hmac_secret_ref text,
  jwks_url text,
  audience text,
  issuer text,
  created_at timestamptz not null,
  rotated_at timestamptz
);

-- Append-only security/audit trail for the execution plane.
agent_audit_log (
  id uuid primary key,
  run_id uuid,
  owner_subject text,
  actor text not null,                   -- service identity making the call
  action text not null,                  -- e.g. tool.invoke, agent.invoke, authz.deny
  capability text,
  decision text not null,                -- allow | deny
  reason text,
  correlation_id text,
  created_at timestamptz not null
);
```

Store large prompts, tool results, and final outputs in encrypted object
storage; keep only references in `postgres-agents`.

### 6.3 `redis-orchestrator` (Celery broker + result backend)

Add a dedicated Redis instance separate from `redis-cache` (LRU) and the already
provisioned `redis-agent` (agent working state). Harden it exactly like the
existing Redis services in `docker-compose.yml`: password-protected, `appendonly
yes`, **`noeviction`** (broker messages must never be silently dropped), not
published to the host, and `rediss://` (TLS) in any non-local environment.

```yaml
  # Dedicated Celery broker + result backend for the orchestration plane.
  # noeviction protects queued/running task state from being dropped under
  # memory pressure. Never published to the host; use rediss:// in production.
  redis-orchestrator:
    image: redis:7-alpine
    container_name: nova-redis-orchestrator
    command:
      - redis-server
      - --requirepass
      - ${REDIS_ORCHESTRATOR_PASSWORD:-nova_redis_orchestrator_password}
      - --appendonly
      - 'yes'
      - --maxmemory
      - 512mb
      - --maxmemory-policy
      - noeviction
    environment:
      REDISCLI_AUTH: ${REDIS_ORCHESTRATOR_PASSWORD:-nova_redis_orchestrator_password}
    volumes:
      - nova-redis-orchestrator-data:/data
    healthcheck:
      test: ['CMD-SHELL', 'redis-cli ping | grep -q PONG']
      interval: 10s
      timeout: 5s
      retries: 20

  # Dedicated orchestration-state database, isolated from the business `nova`
  # DB. The execution plane never connects to the business DB directly.
  postgres-agents:
    image: postgres:16-alpine
    container_name: nova-postgres-agents
    environment:
      POSTGRES_DB: ${POSTGRES_AGENTS_DB:-nova_agents}
      POSTGRES_USER: ${POSTGRES_AGENTS_USER:-nova_agents}
      POSTGRES_PASSWORD: ${POSTGRES_AGENTS_PASSWORD:-nova_agents_password}
    volumes:
      - nova-postgres-agents-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_AGENTS_USER:-nova_agents} -d ${POSTGRES_AGENTS_DB:-nova_agents}']
      interval: 5s
      timeout: 5s
      retries: 20
```

Add the new named volumes (`nova-redis-orchestrator-data`,
`nova-postgres-agents-data`) to the `volumes:` block. Note both new stores are
**not** published to the host (no `ports:`), matching the security posture of
`redis-cache` / `redis-agent`. The orchestration services receive their
connection strings as validated env (`loadConfig`), e.g.
`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `AGENTS_DATABASE_URL`.

## 7. Orchestration state model

Recommended task statuses:

```text
queued, accepted, planning, running, waiting_for_agent, waiting_for_tool,
waiting_for_input, retrying, partially_completed, completed, failed,
canceled, expired
```

Recommended event types:

```text
run.created, run.accepted, run.started,
planner.started, planner.completed,
agent.selected, agent.call.started, agent.call.progress,
agent.call.completed, agent.call.failed,
tool.call.started, tool.call.completed, tool.call.failed,
authz.denied,                              -- security-visibility event
artifact.created,
webhook.delivery.started, webhook.delivery.succeeded, webhook.delivery.failed,
run.completed, run.failed, run.canceled
```

Each event carries a monotonic per-run `sequence`, `runId`, `ownerSubject`,
`type`, `timestamp`, `correlationId`, `causationId`, `payload`, `visibility`
(`user | internal | security`), and `schemaVersion`. `security`-visibility
events (e.g. `authz.denied`) are never returned to the end-user stream.

## 8. Celery task design

```python
@app.task(
    bind=True,
    name="orchestrator.run",
    autoretry_for=(TransientAgentError, TransientToolError),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 5},
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=7200,
    soft_time_limit=6900,
)
def run_orchestration(self, run_id: str, request_id: str, idempotency_key: str,
                      entitlement_snapshot_id: str, entitlement_snapshot_hash: str):
    ...
```

Required execution pattern:

1. Acquire a distributed lock for `runId` (on `redis-orchestrator`).
2. Load run state from `postgres-agents`; if already terminal, return.
3. Load the entitlement snapshot; verify `snapshot_hash` and `expires_at`. If
   missing, tampered, or expired -> emit `authz.denied` (security visibility),
   mark `failed`, and stop. **Fail closed.**
4. Mark `accepted`/`running`; emit `run.started`.
5. Execute the graph; before each step run the code policy gate (section 9).
6. Persist each step before and after external calls (idempotency below).
7. Emit outbox events in the same DB transaction as the state change.
8. On transient failure, mark retry state and raise a retryable exception.
9. On success, store the final response and emit `run.completed`.
10. On permanent failure, emit `run.failed`.

Idempotency keys for every external call:

```text
agent-call:{runId}:{stepId}:{attempt}
tool-call:{runId}:{stepId}:{toolName}
webhook:{eventId}:{destination}
```

Before executing a step, check whether that step already completed. This
protects against Celery retries, worker death, broker redelivery, deployment
interruption, and webhook retries.

## 9. Authorization propagation: the heart of the design

This is the explicit answer to "my A2A agents must check whether the specific
user can or cannot request a certain service, and the same in every MCP server."

### 9.1 Capture (at the API edge, the only place the user token exists)

When `POST /api/v1/agent-runs` is authorized (`create-agent-run`), the Node
service:

1. Resolves the user and their realm roles from the validated `AuthContext`.
2. Computes the derived permission set with `permissionsForRoles` (`@nova/shared`).
3. Resolves the `capability_allowlist` from the permission set via the capability
   catalog (section 5.5).
4. Writes an **immutable** `agent_run_entitlements` row, computes
   `snapshot_hash = sha256(canonical(roles, permissions, capability_allowlist,
   owner_subject, issued_at, expires_at))`, and pins it to the `agent_run`.
5. Sets `expires_at` to bound how long an async run may continue acting for the
   user (e.g. run TTL), independent of the user's short-lived access token.

The user's raw access token is never persisted and never enqueued.

### 9.2 Propagate (control plane -> execution plane)

* Node -> Orchestrator API: `client_credentials` token, `aud: nova-orchestrator`,
  short expiry, body carries IDs only.
* Worker -> Agent/MCP: `client_credentials` token, `aud: nova-agent-<name>` or
  `nova-mcp-<name>`, short expiry. The acting user's identity travels as the
  `runId` + `entitlement_snapshot_id`, resolved server-side, not as a trusted
  header.

### 9.3 Enforce (independently, in every executor — default deny)

Two layers, both data-driven:

**Layer A — planner toolset filtering (reduce attack surface).** Before the
planner/LLM runs, compute the user's allowed capability set =
`{ C in catalog : C.requiredPermissions ⊆ snapshot.permissions }` and hand the
planner *only* those skills/tools. The model literally cannot see, name, or plan
a skill the user is not entitled to, which neutralizes most prompt-injection
attempts to invoke privileged actions. This is convenience + defense, never the
sole control.

**Layer B — code policy gate (authoritative, default deny).** The orchestrator
worker re-checks before every hop, regardless of what the planner produced:

```text
worker wants capability C (agent skill or MCP tool)
  -> look up C's descriptor in the catalog (deny if none)
  -> load entitlement snapshot; verify hash + not expired (deny otherwise)
  -> require EVERY p in C.requiredPermissions to be granted by
     roles_grant_permission(snapshot.roles, p)  (deny on any missing)
  -> if C.risk == 'high': require a recorded human approval (s.18) (deny otherwise)
  -> mint audience-restricted service token for the target
  -> execute; record agent_audit_log (allow); persist event
on deny: emit authz.denied (security visibility), record audit, stop the step
```

Crucially, the **agent and MCP server repeat the check** rather than trusting
the worker:

* Each A2A agent validates its inbound service token (`aud: nova-agent-<name>`),
  loads the entitlement snapshot for the `runId` (or receives it as a signed,
  short-lived claim), resolves the requested capability's required permission via
  `nova_authz`, and denies if the snapshot does not grant it.
* Each MCP server is a resource server: it validates its inbound token
  (`aud: nova-mcp-<name>`, issuer/exp/nbf/alg/signature via Keycloak JWKS),
  resolves the per-tool required permission, checks it against the snapshot, and
  fails closed (deny + audit) on any gap.

The LLM/planner never makes an authorization decision and can never widen the
allowlist. Prompt-injected instructions to "use tool X" still hit the code gate
and are denied if the user lacks the permission.

### 9.4 Optional enhancement: Keycloak Token Exchange

For the *interactive/synchronous* path (user online, short turn), Keycloak
**Token Exchange (RFC 8693)** can mint a downstream, audience-restricted token
that carries the user's identity to an agent/MCP, so the resource server
authorizes the real user directly. For *long-running async* runs this is not
sufficient on its own (user tokens expire), so the snapshot + independent
enforcement remains authoritative. Token exchange is an additive defense-in-depth
layer, not a replacement.

## 10. Multi-agent orchestration model

Use an explicit orchestration graph (LangGraph), not uncontrolled recursion:

```text
Planner Agent -> execution plan
  -> Agent Step 1 -> Tool Step 2 -> Agent Step 3 -> Join/summarize -> Final
```

Every agent/tool call goes through a typed adapter (`send_task`, `subscribe`,
`get_result`, `cancel`) and, before that, the code policy gate (section 9.3).
Never let an agent call tools directly without policy enforcement. Apply
LangGraph guardrails from the engineering skill: typed graph state, validated
node outputs, explicit termination, timeouts, and max-iteration guards.

## 11. A2A integration

For each A2A-compatible agent:

1. Load its Agent Card from a trusted registry; validate capabilities.
2. Authorize the intended capability through the policy gate.
3. Create the task / send the message with an audience-restricted token.
4. Register push-notification config when supported; subscribe for streaming.
5. Persist the A2A task id in `agent_steps.external_task_id`.
6. Normalize A2A events into the internal event schema:

```text
A2A taskId         -> agent_steps.external_task_id
A2A statusUpdate   -> agent.call.progress
A2A artifactUpdate -> artifact.created
A2A final task     -> agent.call.completed
A2A failed task    -> agent.call.failed
```

Treat every inbound and outbound A2A message as an untrusted boundary; validate
against a schema and use typed envelopes with correlation/trace IDs.

## 12. Webhook delivery (transactional outbox)

Do not send webhooks from inside the Celery orchestration task. Write the event
and its outbox row in the same `postgres-agents` transaction; a separate webhook
dispatcher reads pending rows, sends, records success/failure, and retries with
backoff. Benefits: no lost events on crash, independent retries, per-user rate
limiting, easier auditing.

## 13. Bearer-token secured webhooks

Use HTTPS, an OAuth2 `client_credentials` bearer token (audience-restricted,
short expiry, scope-limited), optional mTLS, **plus** an HMAC signature over the
raw body, a timestamp header, an event-id nonce, a replay cache, and an
idempotent receiver.

Signature base string:

```text
v1:{timestamp}:{eventId}:{sha256(rawBody)}
signature = base64url(HMAC-SHA256(secret, baseString))
```

Receiver must, in order: verify HTTPS; validate the bearer token
(`iss`/`aud`/`exp`/`iat`/signature/alg); validate mTLS if enabled; check
timestamp drift; recompute the HMAC with constant-time comparison; confirm the
`eventId` is new; confirm the `runId` belongs to the owner; persist idempotently;
and return `2xx` only after durable persistence.

Retry on network timeout / 408 / 429 / 5xx with exponential backoff + jitter
(immediate, 10s, 30s, 2m, 10m, 30m, 2h, then dead-letter). Do not retry on
400/401/403/404 or invalid config. Provide admin replay tooling.

## 14. Frontend progress delivery

React does not receive webhooks directly. The dispatcher calls the Node internal
callback endpoint, which persists the event, publishes to a Redis pub/sub channel
(reuse `redis-cache` or a dedicated channel), and the frontend receives it over
SSE/WebSocket:

```http
GET /api/v1/agent-runs/:runId/events
Authorization: Bearer <user_access_token>
Accept: text/event-stream
```

The events endpoint is authorized by `read-agent-run` **and** an ownership check
(`agent_runs.owner_subject == auth.subject`). Only `user`-visibility events are
streamed; `internal`/`security` events never leave the backend. The frontend
reconnects using `Last-Event-ID`.

## 15. Authorization model summary

This supersedes the original draft's generic scope list.

### 15.1 Human (user) authorization

Every API request enforces, via the centralized pipeline:

```text
user is authenticated (valid Keycloak token, aud nova-api)
user has create-agent-run to submit
user has read-agent-run AND owns the run to read/stream
user has cancel-agent-run AND owns the run to cancel
```

Never trust `runId`, `ownerSubject`, or `userId` from the client without an
ownership check in the service layer.

### 15.2 Service authorization

Each service is a distinct Keycloak confidential client (section 5.1) with
least-privilege audience access. Tokens are audience-restricted and short-lived.
No service shares another's credentials.

### 15.3 Tool / capability authorization

Tools are reached only through the MCP tool gateway, never directly by an agent.
The gateway and each MCP server enforce: capability->permission gate against the
entitlement snapshot, per-tool argument schema validation, rate and budget
limits, data-classification policy, PII redaction, egress/SSRF restrictions, and
audit logging. Default deny for any capability not in the catalog.

## 16. Secrets management

Follow the existing repo convention: configuration is validated env via
`loadConfig` (`@nova/shared`); in production, source secrets from a managed
secret store. Never store raw secrets in Celery payloads, logs, browser storage,
plain DB columns, Langfuse traces, or shared build logs. Persist only references
(e.g. `webhook_auth_configs.hmac_secret_ref = "kv://owner/<sub>/webhook/hmac/v3"`).
Rotate signing keys per IdP policy, HMAC webhook secrets every 90-180 days,
mTLS certs automatically, and support overlapping key windows.

## 17. Broker and Celery hardening

Nova standardizes on **`redis-orchestrator`** (per the requirement) as the Celery
broker and result backend, with `postgres-agents` as the source of truth, so
Redis durability tradeoffs are bounded (state can always be rebuilt from
Postgres). RabbitMQ remains a valid future option if richer routing/DLX is
needed, but is not required now.

Broker requirements: TLS enforced (`rediss://`) outside local, private network
only, no public exposure, per-service credentials, dedicated logical separation
from `redis-cache`/`redis-agent`, and monitoring on queue depth and oldest
message age.

```python
broker_use_ssl = True            # rediss:// outside local
task_serializer = "json"
accept_content = ["json"]
result_serializer = "json"
task_acks_late = True
task_reject_on_worker_lost = True
worker_prefetch_multiplier = 1
task_soft_time_limit = 6900
task_time_limit = 7200
task_default_retry_delay = 30
task_routes = {
    "orchestrator.run": {"queue": "orchestrator.longrunning"},
    "webhook.deliver": {"queue": "webhooks"},
}
worker_cancel_long_running_tasks_on_connection_loss = True
broker_connection_retry_on_startup = True
```

Run separate worker pools (orchestrator-longrunning, tool-io, webhook-dispatch,
cleanup). Do not mix CPU-heavy with I/O-heavy long-running tasks.

## 18. Long-running execution safety

Implement `last_heartbeat_at`, worker heartbeat events, admin and user
cancellation, and timeouts/budgets per run/step/agent-call/tool-call (max tool
calls, max agent handoffs, max recursion depth, max tokens/cost, max artifact
size).

Cancellation: user clicks cancel -> Node verifies `cancel-agent-run` + ownership
-> sets `cancel_requested` -> the Celery task checks between steps -> external
A2A tasks are canceled -> run marked `canceled` -> final event emitted.

High-risk capabilities (`send_email`, `delete_data`, `modify_database`,
`execute_code`, `purchase_item`, `transfer_money`, `change_permissions`,
`deploy_service`) require an explicit human approval gate in addition to the
permission check.

## 19. Agent and tool sandboxing & prompt-injection safety

Treat agents and tools as untrusted. Enforce a strict outbound allowlist
(SSRF-protected egress gateway; webhook/callback URLs may not target internal
IPs), network segmentation, container isolation, read-only filesystems where
possible, per-tool scoped credentials, output validation, and PII/secret
scanning on tool outputs.

Security middleware around the orchestrator: immutable system prompt, tool
allowlist, tool-argument schema validation, retrieval-source labeling, clear
untrusted-content boundaries, no secrets in model context, agent-output
validation, human-in-the-loop for privileged tools, and an audit log of every
tool call and agent delegation. A downstream agent can never override owner
permissions, the capability allowlist, the callback URL, or security
instructions.

## 20. Observability

OpenTelemetry across React -> Node API -> Orchestrator API -> Celery task ->
agent calls -> tool calls -> webhook delivery, propagating `traceparent`,
`X-Correlation-Id`, `X-Request-Id`, `runId`, `ownerSubject`, `eventId`.

Python agents use **Langfuse** for LLM/tool tracing (per the engineering skill),
with PII/secret redaction before any field is emitted. Node logs stay structured
JSON via the existing pino setup. Redact authorization headers, webhook tokens,
HMAC secrets, API keys, PII, and sensitive prompt content everywhere.

Metrics: `agent_run_{created,completed,failed}_total`,
`agent_run_duration_seconds`, `agent_step_duration_seconds`,
`agent_tool_call_total`, `authz_denied_total`,
`webhook_delivery_{success,failure}_total`, `webhook_delivery_latency_seconds`,
`celery_queue_depth`, `celery_task_retries_total`,
`celery_worker_heartbeat_age_seconds`.

## 21. API contracts (`/api/v1`)

```http
POST   /api/v1/agent-runs            -> { runId, status: "queued", createdAt }
GET    /api/v1/agent-runs/{runId}    -> { runId, status, createdAt, updatedAt, finalResponse }
GET    /api/v1/agent-runs/{runId}/events?afterSequence=40
POST   /api/v1/agent-runs/{runId}/cancel -> { runId, status: "cancel_requested" }
```

`POST /api/v1/agent-runs` requires `create-agent-run` and an `Idempotency-Key`
header; the GET/cancel routes require `read-agent-run` / `cancel-agent-run` plus
an ownership check. The existing `POST /api/v1/a2a/chat` becomes the chat-facing
entry point that internally creates an agent run and returns the `runId` +
`eventsUrl`, reusing conversation/message persistence.

## 22. Deployment model

```text
namespace: app       -> react-frontend, nova-api, nova-orchestrator, webhook-dispatcher
namespace: workers   -> celery-orchestrator, celery-tool, celery-webhook workers
namespace: agents    -> A2A agents, MCP servers
namespace: data      -> postgres (nova), postgres-agents, redis-cache, redis-agent, redis-orchestrator
namespace: identity  -> keycloak
```

Use private networking, NetworkPolicies (the execution-plane namespaces cannot
reach the `nova` business DB), Pod Security Standards, workload identity, mTLS
service mesh if available, HPA, separate worker node pools, resource limits, PDBs,
rolling/canary deploys for orchestrator changes.

## 23. CI/CD security gates

TypeScript strict mode; Python type checking (mypy) + Ruff; unit/integration
tests (broker + both Postgres instances); the **authz parity check** that fails
if the Python `nova_authz` registry drifts from `@nova/shared`; the authz test
matrix (section 24); contract tests for webhook payloads; A2A compatibility
tests; SAST; dependency, container-image, secret, and IaC scanning; SBOM; signed
images; production deployment approval. Run the repo's existing format, lint,
typecheck, test commands and the skill-library validator. Never weaken
lint/type/test/CI settings to pass.

## 24. Testing plan

### 24.1 Functional

Create run; queued status; progress/tool-usage/final events; retrieve artifact;
cancel; retry failed agent call; resume after worker restart.

### 24.2 Security (mandatory authz matrix)

* No token / invalid / expired / wrong audience / wrong issuer rejected.
* `create-agent-run` missing -> 403 on submit.
* `read-agent-run`/`cancel-agent-run` missing -> 403.
* **Cross-owner** run access/stream/cancel rejected (ownership check).
* **Capability not in catalog** -> denied.
* **User lacks the capability's permission** -> denied at the worker gate AND
  independently at the agent AND at the MCP server (three layers tested).
* **Tampered / expired entitlement snapshot** -> run fails closed.
* Prompt-injection attempting an unauthorized tool -> denied (no escalation).
* Missing/invalid/replayed webhook HMAC, stale timestamp -> rejected.
* SSRF / internal-IP callback URL blocked.
* No secret/token/PII appears in logs, broker messages, or Langfuse traces.

### 24.3 Reliability

Broker restart; worker crash mid-run; duplicate delivery; webhook receiver down;
slow downstream agent; tool timeout; partial A2A failure; DB failover; outbox
replay; deployment during an active run.

## 25. Rollout phases (anchored to the current repo)

The repo already has: the `nova` realm + roles, the centralized auth pipeline,
the `@nova/shared` RBAC registry, the chat module with a placeholder
`AgentGateway`, and a provisioned-but-unused `redis-agent`.

### Phase 0: Infrastructure (this plan's prerequisites)

* Add `postgres-agents` and `redis-orchestrator` to `docker-compose.yml`
  (section 6.3) with validated env config.
* Add the new permissions to `@nova/shared` + DB seed (section 5.3).
* Add the new Keycloak clients to the realm (section 5.1).

### Phase 1: Secure foundation

* `modules/agent-runs/` in `@nova/api` (routes/policies/service/repository/DTO).
* `agent_runs` + `agent_run_entitlements` + `agent_run_events` in `postgres-agents`.
* Celery orchestration worker on `redis-orchestrator`; entitlement-snapshot
  capture and worker-side policy gate.
* SSE/polling event stream; `client_credentials` service tokens between Node and
  the orchestrator.

### Phase 2: Durable async execution

Transactional outbox; webhook dispatcher; retry + dead-letter; idempotency;
cancellation; heartbeat/timeout handling.

### Phase 3: A2A and multi-agent orchestration

Agent registry; A2A adapter; capability validation; step graph; artifact
persistence; MCP tool gateway with per-tool permission enforcement; the
`nova_authz` Python parity package + CI drift check.

### Phase 4: Enterprise security depth

HMAC webhook signatures; mTLS; optional Keycloak Token Exchange; managed
secret-store integration; full audit logging; rate and budget limits.

### Phase 5: Production hardening

OpenTelemetry; Langfuse dashboards/alerts; chaos and penetration testing;
compliance evidence exports; run replay and admin diagnostics.

## 26. Most important decisions (Nova target)

```text
React (nova-frontend)
  -> Node TypeScript API (nova-api): authn + centralized RBAC + entitlement snapshot
  -> Orchestrator API (nova-orchestrator): service-token validated
  -> Celery on redis-orchestrator
  -> Celery workers (nova-celery-worker): code policy gate per hop
  -> A2A agents (nova-agent-*) + MCP tool gateway (nova-mcp-*): re-enforce authz
  -> postgres-agents (isolated state + outbox; no access to business nova DB)
  -> webhook dispatcher (bearer + HMAC + nonce)
  -> SSE/WebSocket to React
```

Security baseline:

```text
Keycloak OIDC + PKCE for users (roles in token; permissions derived in code)
Keycloak client_credentials, audience-restricted, for every service
Immutable per-run entitlement snapshot captured at the API edge
Independent, default-deny authorization re-enforced in every agent and MCP server
Capability -> permission catalog with TS/Python parity (no drift)
postgres-agents isolated from the business nova database
redis-orchestrator dedicated broker (noeviction), Postgres as source of truth
Transactional outbox for events; idempotency everywhere
Bearer + HMAC + timestamp + nonce for webhooks
No user tokens, secrets, or PII in broker messages, logs, or Langfuse traces
No frontend or LLM authorization decisions
Full audit trail
```

This design is secure by default, recoverable, auditable, and scalable for
long-running multi-agent workflows, and it reuses Nova's existing Keycloak +
centralized RBAC foundations rather than creating parallel mechanisms.
