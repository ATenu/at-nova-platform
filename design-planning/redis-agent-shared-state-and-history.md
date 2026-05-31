# Redis-Agent Shared State & Aligned Conversation History

- **Status:** Implemented (orchestrator worker + `at-sql-analyser`, behind `AGENT_STATE_ENABLED` + `REDIS_AGENT_URL`)
- **Owner:** Orchestration / Agents platform
- **Scope:** `services/orchestrator`, `agents/*`, `backend-services/packages/shared`, `docker-compose.yml`, env
- **Related rules:** `010-security-by-design`, `000-core-engineering`, `040-python-langgraph-agents`

> **Implementation note (kept in sync with code):** The shared `AgentStateStore`
> (per-run Redis Hash sections + per-conversation Redis Stream history) is live in
> `services/orchestrator/.../agent_state.py` and `agents/at-sql-analyser/.../agent_state.py`.
> The orchestrator is the single writer of history (`graph.py` `_record_turn`) and
> reads it back for prompt grounding (`_load_history`); agents read history and write
> their own section. Storage is entitlement-gated by `content_policy.py`: an entitled
> owner's own data (incl. PII) is kept verbatim for this owner-scoped working memory,
> secrets are always stripped, and content from any capability outside the verified
> entitlement snapshot is withheld (default deny). The rolling `:summary` key and any
> Node-side Redis reads remain future work. The sections below describe the original
> design; treat the code as authoritative where they differ.

---

## 1. Problem & motivation

Today each agent run is **stateless across turns** and **state is discarded after each hop**:

- A new chat message creates a **new `AgentRun`**; the orchestrator fetches only the *single latest user message* (`promptRef` → one conversation message) as its `REQUEST`. Prior turns are never given to the reasoner. (See `tool-gateway.service.ts#getPrompt` and `agent-run.service.ts#createRun`.)
- The orchestrator's working state (`OrchestrationState` in `dag.py`) is an **in-memory LangGraph TypedDict** that exists only for the lifetime of one Celery task and is then thrown away.
- Downstream agents (e.g. `at-sql-analyser`) receive **only the `goal` string** over A2A and keep their own ephemeral `GraphState` (`harness/state.py`). They have no access to what other agents did, nor to earlier turns.
- Durable artefacts (`agent_runs`, `agent_run_events`, `agent_steps`) live in **`postgres-agents`** and are an *audit/event* projection, not a working-memory document that agents can efficiently read/write mid-run.

We want:

1. **All agents to use the already-provisioned `redis-agent`** instance as the shared, fast working-state store.
2. A **single coherent state document** per run/conversation where **each agent owns its own JSON section** (namespaced, isolated) — "a perfect combination".
3. A **common conversation history** that is **written and kept aligned by the orchestrator only**, and is **readable by every agent**, so multi-turn context and cross-agent context are consistent.

## 2. Goals / Non-goals

### Goals
- Introduce a typed, shared **agent-state store** abstraction backed by `redis-agent`, usable from the orchestrator and every Python agent.
- One **state document per run** with per-agent JSON sections + a shared, orchestrator-owned **history** keyed per **conversation** (so it spans turns).
- **Single-writer** history model (orchestrator) for alignment/consistency; agents read history and write only their own section.
- Preserve every security invariant: owner-scoped, default-deny, **no secrets / no raw SQL** in shared state, TLS in prod, bounded size + TTL. **PII is entitlement-gated, not stripped:** an owner entitled to a capability sees its full result verbatim across turns; content from capabilities outside their snapshot allowlist is withheld.
- Be **resumable/idempotent-friendly**: surviving a worker crash mid-run is a bonus, not a regression.

### Non-goals
- Replacing Postgres as the **source of truth** for runs/events/audit. Redis is working memory + fast shared context; Postgres remains the durable audit ledger.
- Replacing the Celery broker/result backend (`redis-orchestrator`) — that stays separate.
- Long-term/semantic memory or vector recall (future work; this lays the substrate).
- Changing the A2A security model (tokens, snapshots, audience pinning stay exactly as-is).

## 3. Current state (what already exists)

| Concern | Today | File |
|---|---|---|
| `redis-agent` instance | Provisioned, `noeviction`, AOF persistence, password, dedicated volume, **no consumer** | `docker-compose.yml` |
| Connection URL | `REDIS_AGENT_URL` defined, reserved | `.env.example`, `docker-compose.yml` |
| Python redis dep | `redis>=5,<6` already a dep of the orchestrator; `types-redis` present | `services/orchestrator/pyproject.toml` |
| Orchestrator working state | In-memory `OrchestrationState` TypedDict, discarded per task | `dag.py` |
| Agent working state | In-memory `GraphState`, ephemeral | `at-sql-analyser/.../harness/state.py` |
| Prompt to model | Single latest message + this-run observations only | `prompts.py`, `tool-gateway.service.ts` |
| Durable record | `agent_runs` / `agent_run_events` / `agent_steps` in `postgres-agents` | `models.py` |
| Shared cache pattern (TS) | `CacheClient` (JSON get/set/del) over `redis-cache` | `packages/shared/src/redis/cache.ts` |

The `redis-agent` container and `REDIS_AGENT_URL` exist precisely so this feature has a home — we are wiring up the reserved instance, not adding infrastructure.

## 4. Proposed architecture

### 4.1 Conceptual model

```
redis-agent
└── conversation:{conversationId}                     (spans turns; orchestrator-owned)
    ├── history            → Redis Stream (append-only, ordered, capped)
    └── summary            → rolling redacted summary (bounded string)

└── run:{runId}                                        (one turn; shared doc)
    └── state              → Redis Hash
        ├── meta           → { ownerSubject, conversationId, status, schemaVersion, updatedAt }
        ├── orchestrator   → { plan, observations[], decisions[] }   (orchestrator section)
        ├── agent:sql-analyst → { attempts_meta[], lastAnswerRef, ... } (agent section)
        └── agent:<name>   → { ... }                                  (one field per agent)
```

- **Per-run document** = one Redis **Hash** at `nova:agent:run:{runId}:state`. Each top-level actor (the orchestrator + each agent) owns exactly **one hash field** whose value is a JSON blob — this is the "each agent has its own JSON attribute section" requirement, with field-level isolation and independent writes (no read-modify-write of the whole doc).
- **Common history** = a Redis **Stream** at `nova:agent:conv:{conversationId}:history`. Append-only and ordered by Redis-assigned IDs → naturally "aligned". Keyed by **conversation**, so it persists across turns/runs and gives the multi-turn context that is missing today.
- A bounded **rolling `summary`** string per conversation keeps prompt size constant as history grows (the orchestrator refreshes it during `compose`).

### 4.2 Ownership & write rules (alignment guarantee)

| Data | Writer(s) | Readers |
|---|---|---|
| `conv:{id}:history` (Stream) | **Orchestrator only** (single writer ⇒ consistent ordering) | Orchestrator + all agents (read-only) |
| `conv:{id}:summary` | **Orchestrator only** | Orchestrator + all agents (read-only) |
| `run:{id}:state[orchestrator]` | Orchestrator | All |
| `run:{id}:state[agent:<name>]` | **That agent only** (writes its own field) | All |

The orchestrator is the **canonical historian**: agents never write history directly. After an agent finishes, it returns its typed result over A2A (unchanged); the orchestrator folds the salient, redacted outcome into the history Stream. This keeps history aligned and prevents agents from corrupting each other's view. Per-field hash writes (`HSET field value`) avoid lost-update races; the existing per-run Postgres advisory lock already serialises a single run.

### 4.3 Why Redis primitives (not RedisJSON)

`redis:7-alpine` has **no RedisJSON module**. We therefore use **core primitives only**:
- **Hash** with JSON-encoded fields for the per-run doc (atomic per-field writes via `HSET`/`HGET`).
- **Stream** (`XADD`/`XRANGE`/`XLEN`, `MAXLEN ~ N`) for capped, ordered history.

This keeps us provider-agnostic (works on Azure Cache for Redis, ElastiCache, Upstash, Redis Cloud) with zero module dependencies.

## 5. Key schema & data shapes

All keys are prefixed `nova:agent:` (the instance is single-purpose, but a prefix keeps tooling clean).

| Key | Type | Purpose | TTL |
|---|---|---|---|
| `nova:agent:run:{runId}:state` | Hash | Per-turn shared doc; one field per actor | `AGENT_RUN_TTL_SECONDS` (7200) |
| `nova:agent:conv:{convId}:history` | Stream | Aligned multi-turn history (capped `MAXLEN ~ 200`) | `AGENT_HISTORY_TTL_SECONDS` (e.g. 30d) |
| `nova:agent:conv:{convId}:summary` | String (JSON) | Rolling redacted summary | same as history |

**History entry (Stream fields)** — redacted, never raw:

```json
{
  "turn": "42",
  "runId": "<uuid>",
  "role": "user | assistant | agent | tool",
  "actor": "orchestrator | sql-analyst | data.analyse.read",
  "summary": "Counted active customers: 128",
  "ts": "2026-05-31T14:30:00Z"
}
```

**Per-agent section value** (example, SQL analyst) — metadata only, no SQL/rows/PII:

```json
{
  "schemaVersion": 1,
  "lastSkill": "data.analyse.read",
  "queryCount": 3,
  "lastSummary": "Returned 128 rows (hash a1b2…)",
  "updatedAt": "2026-05-31T14:30:00Z"
}
```

The store enforces a **max value size** (e.g. 32 KiB/field) and rejects oversized writes to bound memory and prompt blast radius.

## 6. Shared abstraction (typed, reusable)

Create one small, typed module reused everywhere — **reuse over re-implementation** (`000-core-engineering`).

### 6.1 Python — `nova_agent_state` (shared package or vendored module)
A single client used by the orchestrator and every agent:

```python
class AgentStateStore:
    def __init__(self, *, url: str, owner_subject: str, key_prefix: str = "nova:agent:") -> None: ...

    # Per-run doc (per-actor JSON section)
    def read_section(self, run_id: str, actor: str) -> dict[str, Any] | None: ...
    def write_section(self, run_id: str, actor: str, value: dict[str, Any]) -> None: ...
    def read_document(self, run_id: str) -> dict[str, dict[str, Any]]: ...

    # Common history (orchestrator is the only writer)
    def append_history(self, conversation_id: str, entry: HistoryEntry) -> None: ...  # orchestrator only
    def read_history(self, conversation_id: str, *, limit: int = 50) -> list[HistoryEntry]: ...
    def read_summary(self, conversation_id: str) -> str | None: ...
    def write_summary(self, conversation_id: str, summary: str) -> None: ...          # orchestrator only
```

- `HistoryEntry` is a Pydantic model validated on read **and** write (treat stored data as untrusted at the trust boundary, per `040`).
- All keys derived from `owner_subject` + ids; a mismatched `ownerSubject` in `meta` ⇒ **fail closed** (default deny).
- TTL applied on every write so abandoned state self-expires.
- `redis-py` client built from `REDIS_AGENT_URL`; TLS auto-enabled for `rediss://` (mirror the TS `parseRedisUrl` discipline). Connection failures **fail soft for reads** (degrade to no-history) but are logged; the run still proceeds.

### 6.2 TypeScript (optional, later)
The Node control plane could read the history for UI/debug via the existing `CacheClient` pattern pointed at `redis-agent`. Not required for the core feature; out of initial scope.

## 7. End-to-end flows

### 7.1 New user turn (orchestrator)
1. Celery task starts (`process_run`), acquires advisory lock, verifies snapshot (unchanged).
2. **Load context:** read `conv:{convId}:summary` + last *N* `history` entries from `redis-agent`.
3. Build the reasoner prompt = **redacted history/summary** (as a delimited *untrusted DATA* block) + current message + this-run observations. → fixes the multi-turn gap.
4. Reason / dispatch loop runs as today. Orchestrator persists its working section to `run:{runId}:state[orchestrator]` as it progresses (resumability).
5. On agent dispatch, the orchestrator passes `runId` + `conversationId` in the A2A `DataPart` (it already passes `runId`; add `conversationId`). **No tokens/PII** — unchanged contract.
6. **Compose/finalize:** append the assistant turn to `conv:{convId}:history`, refresh the rolling `summary`, then persist the assistant message to Postgres/`nova` exactly as today.

### 7.2 Agent execution (e.g. SQL analyst)
1. Parses task (now also reads `conversationId`).
2. Constructs an `AgentStateStore` (its own `REDIS_AGENT_URL`, owner from the verified snapshot it already re-fetches).
3. **Reads** common history/summary (read-only) to ground its plan — optional context, never authority.
4. Runs its bounded loop as today.
5. **Writes only its own section** `run:{runId}:state[agent:sql-analyst]` (redacted metadata).
6. Returns its typed A2A result as today. The orchestrator (not the agent) writes the history entry.

### 7.3 Multi-agent alignment
Because the orchestrator is the sole history writer and history is an ordered Stream keyed by conversation, every agent that reads it sees the **same, consistently ordered** view. Per-agent sections are isolated by hash field, so two agents in the same run never clobber each other.

## 8. Security & privacy (maps to `010` / `040`)

- **Default deny / least privilege:** every read/write is owner-scoped; `meta.ownerSubject` is verified against the run's entitlement snapshot before trusting any section. Cross-owner key access is impossible by construction and rejected if attempted.
- **Entitlement-gated content (not blanket PII redaction):** the store is the **owner's own** working memory, keyed by their subject. Content is therefore stored **in full, non-redacted, for the entitled owner** — a user who has the role + permissions to retrieve a capability's data sees that data verbatim (no PII stripping) on later turns. Two invariants still always hold, enforced by `content_policy.resolve_content` / `resolve_text`:
  - **Secrets are never stored.** Tokens/passwords/credentials are stripped by key name (and size/depth bounded) regardless of entitlement — a secret is a credential, not "information the user is entitled to retrieve".
  - **Default deny across capabilities.** Content from a capability **outside the owner's verified `capabilityAllowlist`** is withheld (`{"withheld": true, …}`), so a downstream bug can never persist data the owner was not entitled to.
- **Raw SQL / rows still never leave the agent** — it persists only metadata + the composed answer, exactly as before.
- **Operational telemetry keeps its own redaction:** run events (SSE/webhook), logs, and Langfuse traces are unchanged — they are seen by operators, not the data owner, so their existing scrubbing stays. This change relaxes redaction **only** for the owner-scoped working store.
- **Untrusted on read:** stored state is validated with Pydantic and injected into prompts only inside delimited DATA blocks; embedded instructions are never followed (existing prompt-injection discipline in `prompts.py`).
- **Transport:** `rediss://` (TLS) in any non-local environment; `redis-agent` is password-protected and never published to the host. `noeviction` ensures working state isn't silently dropped.
- **Bounded blast radius:** per-field size caps, Stream `MAXLEN`, and TTLs prevent unbounded growth and limit how much a poisoned history could influence a model.
- **Auditability unchanged:** Postgres remains the immutable audit ledger; Redis is working memory. A Redis loss degrades context but cannot corrupt the audit trail.
- **Fail closed on integrity, fail soft on availability:** snapshot/owner mismatches reject; a Redis outage degrades to today's stateless behaviour (logged) rather than failing the run.

## 9. Config / env additions

| Var | Service(s) | Default | Notes |
|---|---|---|---|
| `REDIS_AGENT_URL` | orchestrator worker, agents | `redis://:…@redis-agent:6379` | Already defined; **wire into worker + agents** `depends_on` + env |
| `AGENT_STATE_KEY_PREFIX` | all | `nova:agent:` | Namespacing |
| `AGENT_STATE_TTL_SECONDS` | all | `7200` | Aligns with run TTL |
| `AGENT_HISTORY_TTL_SECONDS` | orchestrator | `2592000` (30d) | Conversation history retention |
| `AGENT_HISTORY_MAX_ENTRIES` | orchestrator | `200` | Stream `MAXLEN ~` |
| `AGENT_STATE_MAX_FIELD_BYTES` | all | `32768` | Per-section cap |

Add `redis-agent: { condition: service_healthy }` to the orchestrator-worker and agent `depends_on` in `docker-compose.yml` (the instance exists; only the worker/agents need the dependency + `REDIS_AGENT_URL` env passed through). Add `redis>=5,<6` to the agent's `pyproject.toml` (orchestrator already has it).

## 10. Rollout phases

1. **Phase 0 — Abstraction:** add `AgentStateStore` (Python) + typed `HistoryEntry`, unit-tested against a fake/`fakeredis`. No behaviour change.
2. **Phase 1 — Orchestrator history (read path):** load history/summary into the prompt; **gated behind a flag** (`AGENT_STATE_ENABLED`). Immediate multi-turn win.
3. **Phase 2 — Orchestrator history (write path):** append turn + refresh summary on finalize.
4. **Phase 3 — Per-run sections:** orchestrator persists its section; pass `conversationId` over A2A.
5. **Phase 4 — Agent adoption:** `at-sql-analyser` reads history (context) and writes its own section. Template for future agents.
6. **Phase 5 — Hardening:** size/TTL caps, redaction review, failure-mode tests, observability, docs.

Each phase is independently shippable and reversible via the feature flag (fail soft to today's behaviour).

## 11. Testing

- **Unit:** `AgentStateStore` get/set/section isolation, TTL, size-cap rejection, owner-mismatch rejection, history ordering/cap (use `fakeredis`).
- **Validation:** malformed/oversized/cross-owner stored entries are rejected (untrusted-on-read).
- **Integration:** orchestrator multi-turn — turn 2 sees turn 1's redacted summary; two agents in one run write disjoint sections without clobbering.
- **Security:** assert secrets are always stripped and unentitled-capability content is withheld, while an **entitled owner's PII is preserved verbatim** (entitlement-gate tests in `test_content_policy.py` / `test_agent_state.py`); assert owner-mismatch reads return empty; assert prompts wrap history as DATA.
- **Resilience:** Redis-down ⇒ run still completes (degraded, logged); Redis-restored ⇒ resumes.
- Run repo format/lint/typecheck/test for both Python services; do not weaken any settings.

## 12. Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Prompt-injection via poisoned history | Single-writer (orchestrator), redaction, DATA-block framing, size caps |
| Memory growth | `MAXLEN` streams, per-field caps, TTLs, `noeviction` + monitoring |
| Redis outage | Fail soft for reads; Postgres remains source of truth |
| State/audit divergence | Redis is working memory only; never authoritative for authz/audit |
| Cross-turn PII leakage | Owner-scoped keys (subject-stamped `meta`, verified on read) + retention TTL; full content only ever returned to the entitled owner; unentitled-capability content withheld; secrets always stripped |
| Added coupling for agents | Optional/read-only history; agents still function with Redis disabled |

## 13. Open questions

1. **History key = `conversationId`** (assumed best for multi-turn). Confirm vs. a longer-lived per-user thread key.
2. Retention/right-to-erasure: should deleting a conversation purge its history Stream? (Likely yes — add a cleanup hook.)
3. Do we want the Node UI to surface the aligned history/"agent timeline"? (Phase 6, via TS reader.)
4. Should per-run sections also mirror to Postgres for post-hoc debugging, or stay Redis-only (TTL'd)?

---

### TL;DR
Wire up the **already-provisioned `redis-agent`** as a shared working-memory store: a **per-run Hash** where the orchestrator and each agent own an isolated JSON field, plus a **per-conversation history Stream** that **only the orchestrator writes** (so it stays aligned) and **every agent can read**. Add one typed `AgentStateStore` abstraction, keep Postgres as the audit source of truth, store **full content gated by the owner's entitlement** (entitled ⇒ verbatim incl. PII; secrets always stripped; unentitled-capability content withheld), and ship behind a flag in small, reversible phases — with multi-turn context as the first visible win.
