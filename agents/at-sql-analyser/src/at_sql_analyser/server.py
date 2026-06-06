"""Native A2A server (a2a-sdk) for the autonomous SQL analyst agent.

Trust pipeline (unchanged, re-asserted by code regardless of LLM judgment):
  1. Inbound token verified (signature/iss/aud/exp) and ``azp`` pinned to the
     worker, by ``BearerAuthMiddleware`` at the HTTP boundary (fail closed, 401).
  2. The task payload is read as typed DATA (run id / skill / goal); never as
     instructions.
  3. The entitlement snapshot is fetched + integrity-verified by run id (the
     agent never trusts the caller's claims).
  4. Layer B (``auth/policy.authorize``) gates the requested skill — and, for
     writes, each concrete capability independently — against the snapshot.
  5. Only then does the bounded LangGraph DAG run, reading exclusively via the
     DB MCP server and writing only through cataloged capabilities.

The Agent Card advertises skills for discovery/steering, but advertising is not
authorization. Raw SQL, rows, and PII never appear in responses, events, or logs.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any, Literal, Protocol

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.apps import A2AStarletteApplication
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    DataPart,
    Part,
    TaskState,
    TextPart,
)
from a2a.utils import get_data_parts
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .agent_state import AgentStateStore
from .auth.policy import authorize
from .auth.resource_server import AuthError, ResourceServer, VerifiedCaller
from .auth.snapshot import SnapshotClient, SnapshotError, VerifiedSnapshot
from .auth.tokens import ServiceTokenClient
from .authz.policy_gate import REASON_APPROVAL_REQUIRED
from .authz.rbac_registry import RbacRegistryClient, RbacRegistryError, reset_active_registry
from .config import AgentConfig, load_config
from .content_policy import resolve_text
from .harness.graph import GraphDeps, run_task
from .harness.guards import GuardLimits
from .harness.llm import OpenAIReasoner, Reasoner
from .harness.state import AgentResult, TaskInput
from .mcp.catalog_client import fetch_catalog
from .mcp.data_client import DataClient, McpDataClient
from .observability import langfuse_tracing as lf
from .observability.tracing import build_tracer
from .registration import AgentRegistrar
from .skills import AGENT_NAME, SKILL_ACT_WRITE, SKILL_ANALYSE_READ, advertised_skills
from .tools.capability_client import CapabilityClient, HttpCapabilityClient

logger = logging.getLogger(__name__)

StateStoreFactory = Callable[[str], AgentStateStore | None]


class ResourceServerPort(Protocol):
    """Inbound token verification seam (token + azp pinning). Fail closed."""

    def verify(self, authorization_header: str) -> VerifiedCaller: ...


class SnapshotPort(Protocol):
    """Entitlement snapshot fetch + integrity verification by run id."""

    def fetch_verified(self, run_id: str) -> VerifiedSnapshot: ...


class RegistryPort(Protocol):
    """Dynamic RBAC registry refresh seam (publishes the active policy)."""

    def refresh(self) -> object: ...


DataClientFactory = Callable[[str], DataClient]

# Typed payload keys the orchestrator sends in the A2A message DataPart. The
# agent reads them strictly as data.
_KEY_RUN_ID = "runId"
_KEY_SKILL = "skillId"
_KEY_GOAL = "goal"
_KEY_APPROVAL = "approvalGranted"
_KEY_CONVERSATION = "conversationId"
_KEY_LANGFUSE_TRACE = "langfuseTraceId"
_KEY_LANGFUSE_PARENT = "langfuseParentObservationId"

# This agent's own section name in the shared per-run state document.
_STATE_ACTOR = f"agent:{AGENT_NAME}"

# The free-form SQL data-layer entitlement (DB MCP `run_select_query`). The read
# loop only offers the SQL tool family when the caller holds this capability;
# otherwise it plans solely from the entitled structured read capabilities.
SKILL_QUERY_SELECT = "data.query.select"


def build_agent_card(
    cfg: AgentConfig, catalog: list[dict[str, Any]] | None = None
) -> AgentCard:
    """Build the Agent Card, enriching the read skill from the MCP view catalog.

    ``catalog`` is the curated view metadata discovered from the DB MCP server at
    startup (empty/None ⇒ the read skill uses its static fallback description).
    """
    return AgentCard(
        name=AGENT_NAME,
        description="Read-only SQL analyst over curated, PII-aware business views.",
        version="0.1.0",
        url=cfg.public_url,
        # Streaming is on: sub-steps ride the SAME request connection as
        # TaskStatusUpdateEvent frames so the worker persists them mid-run.
        # Push notifications stay off (they add a callback trust boundary we do
        # not need — streaming does not require them).
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        default_input_modes=["text/plain", "application/json"],
        default_output_modes=["text/plain", "application/json"],
        skills=[
            AgentSkill(
                id=skill.id,
                name=skill.name,
                description=skill.description,
                tags=list(skill.intent_keywords),
            )
            for skill in advertised_skills(catalog)
        ],
    )


class BearerAuthMiddleware:
    """Centralized inbound authentication for the A2A RPC surface (fail closed).

    Verifies the worker's audience-restricted token (signature/iss/aud/exp +
    ``azp`` pinning) before any task is constructed. Discovery (the public agent
    card) and health are the only unauthenticated paths.
    """

    def __init__(self, app: ASGIApp, *, resource_server: ResourceServerPort) -> None:
        self._app = app
        self._rs = resource_server

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        if method == "GET" and (path == "/health" or path.startswith("/.well-known/")):
            await self._app(scope, receive, send)
            return
        try:
            caller = self._rs.verify(_header(scope, b"authorization"))
        except AuthError:
            await _send_json(send, 401, {"error": "unauthorized"})
            return
        scope.setdefault("state", {})["nova_caller"] = caller
        await self._app(scope, receive, send)


def _make_updater(context: RequestContext, event_queue: EventQueue) -> TaskUpdater:
    return TaskUpdater(event_queue, context.task_id or "", context.context_id or "")


# Envelope key the worker reads off each intermediate TaskStatusUpdateEvent.
_NOVA_EVENT_KEY = "novaEvent"


class _SubEventStreamer:
    """Publishes the agent's ordered sub-steps live as ``working`` frames.

    The harness sink (``on_event``) is synchronous and called from async graph
    nodes, so this buffers each sub-step on an in-process FIFO and a single
    background task awaits the (async) ``EventQueue`` enqueue — never blocking a
    node on the queue. A monotonic ``agentSeq`` per task lets the worker order +
    dedupe deterministically even if transport reorders. Streaming is fail-soft:
    a dropped frame is backfilled from the terminal artifact's ``collected``.
    """

    def __init__(self, updater: TaskUpdater) -> None:
        self._updater = updater
        self._buffer: asyncio.Queue[tuple[int, str, dict[str, Any]] | None] = asyncio.Queue()
        self._seq = 0
        self._task: asyncio.Task[None] | None = None
        # The full ordered list returned in the terminal artifact (the
        # reconciliation source of truth for any frame the worker missed).
        self.collected: list[dict[str, Any]] = []

    def start(self) -> None:
        self._task = asyncio.create_task(self._drain())

    def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        self._seq += 1
        seq = self._seq
        frame = dict(payload)
        self.collected.append({"type": event_type, "payload": frame, "agentSeq": seq})
        # Non-blocking: the buffer is unbounded so a node never awaits IO here.
        self._buffer.put_nowait((seq, event_type, frame))

    async def _drain(self) -> None:
        while True:
            item = await self._buffer.get()
            if item is None:
                return
            seq, event_type, payload = item
            try:
                await self._updater.update_status(
                    TaskState.working,
                    final=False,
                    metadata={
                        _NOVA_EVENT_KEY: {
                            "type": event_type,
                            "payload": payload,
                            "agentSeq": seq,
                        }
                    },
                )
            except Exception:  # noqa: BLE001, S112 - streaming is best-effort; the
                # terminal-artifact reconcile backfills any frame we could not
                # push, and a streaming failure must never abort the run.
                continue

    async def aclose(self) -> None:
        """Flush all buffered frames, then stop the drainer (before terminal)."""
        if self._task is None:
            return
        self._buffer.put_nowait(None)
        await self._task
        self._task = None


def _history_text(store: AgentStateStore | None, conversation_id: str) -> str:
    """Read the orchestrator-aligned shared history (fail-soft, empty on miss)."""
    if store is None or not conversation_id:
        return ""
    return store.read_history_text(conversation_id)


def _persist_section(
    store: AgentStateStore | None,
    task: TaskInput,
    snapshot: VerifiedSnapshot,
    skill_id: str,
    result: AgentResult,
) -> None:
    """Write this agent's OWN section of the shared per-run state document.

    Entitlement-gated: the composed answer is stored in full (no PII redaction)
    only when the owner is entitled to the skill that produced it; secrets are
    always stripped. Raw SQL/rows never leave the agent, so only metadata + the
    answer are persisted for cross-turn context.
    """
    if store is None:
        return
    answer = result.answer or ""
    store.write_section(
        task.run_id,
        _STATE_ACTOR,
        {
            "skill": skill_id,
            "status": result.status,
            "queryCount": result.query_count,
            "answer": resolve_text(answer, snapshot=snapshot, capability_id=skill_id),
        },
    )


def _header(scope: Scope, name: bytes) -> str:
    for key, value in scope.get("headers", []):
        if key == name:
            return str(value.decode("latin-1"))
    return ""


async def _send_json(send: Send, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": payload})


class SqlAnalystExecutor(AgentExecutor):
    """Runs the trust pipeline then the LangGraph DAG for one A2A task."""

    def __init__(
        self,
        *,
        reasoner: Reasoner,
        snapshot_client: SnapshotPort,
        registry_client: RegistryPort,
        data_client_factory: DataClientFactory,
        capability_client: CapabilityClient,
        limits: GuardLimits,
        state_store_factory: StateStoreFactory | None = None,
    ) -> None:
        self._reasoner = reasoner
        self._snapshot = snapshot_client
        self._registry = registry_client
        self._make_data_client = data_client_factory
        self._capabilities = capability_client
        self._limits = limits
        self._make_state_store = state_store_factory

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = _make_updater(context, event_queue)
        await updater.submit()
        await updater.start_work()

        task = self._parse_task(context)
        if task is None:
            await self._terminal(updater, "failed", None, "malformed_task")
            return

        tracer = build_tracer(task.run_id)

        # Every sub-step is recorded three ways: scrubbed to the tracer (no
        # PII/SQL in logs), pushed LIVE as a working frame over the A2A stream
        # (so the worker persists it mid-run), and verbatim into ``collected``,
        # which is returned in the terminal artifact as the reconciliation source
        # of truth for any frame the worker missed.
        streamer = _SubEventStreamer(updater)
        streamer.start()
        collected = streamer.collected

        def on_event(event_type: str, payload: dict[str, Any]) -> None:
            tracer.event(event_type, payload)
            streamer.emit(event_type, payload)

        on_event("agent.task.received", {"skillId": task.skill_id, "intent": task.intent})

        async def finish(
            status: str, answer: str | None, reason: str | None
        ) -> None:
            # Drain every buffered sub-step BEFORE the terminal frame: an A2A
            # task cannot publish more status updates once a terminal state is
            # reached, so the live stream must be fully flushed first.
            await streamer.aclose()
            await self._terminal(updater, status, answer, reason, collected)

        # Open the agent's root span JOINED to the orchestrator's per-run trace,
        # then build the CallbackHandler inside it so every node + LLM generation
        # nests under the shared context. Tracing is fail-soft (no-op if disabled).
        try:
            with lf.agent_trace(
                run_id=task.run_id,
                name="sql-analyst.execute",
                parent_trace_id=task.langfuse_trace_id,
                parent_observation_id=task.langfuse_parent_observation_id,
            ):
                callbacks = lf.make_callback_handler()
                try:
                    snapshot = await asyncio.to_thread(
                        self._snapshot.fetch_verified, task.run_id
                    )
                except SnapshotError:
                    await finish("denied", None, "entitlement_unavailable")
                    return

                # Refresh the dynamic, DB-driven policy as the active registry the
                # Layer B gate reads. Fail closed: on any outage we clear the
                # active policy and deny, so no skill/capability is authorized
                # against absent policy (the worker + control plane also re-check).
                try:
                    await asyncio.to_thread(self._registry.refresh)
                except RbacRegistryError:
                    reset_active_registry()
                    await finish("denied", None, "registry_unavailable")
                    return

                store = (
                    self._make_state_store(snapshot.owner_subject)
                    if self._make_state_store is not None
                    else None
                )

                if task.skill_id == SKILL_ACT_WRITE:
                    result = await self._run_write(
                        task, snapshot, on_event, tracer.event, store, callbacks
                    )
                elif task.skill_id == SKILL_ANALYSE_READ:
                    result = await self._run_read(
                        task, snapshot, on_event, tracer.event, store, callbacks
                    )
                else:
                    on_event(
                        "agent.task.denied",
                        {"skillId": task.skill_id, "reason": "unsupported_skill"},
                    )
                    await finish("denied", None, "unsupported_skill")
                    return

                await finish(result.status, result.answer, result.reason)
        finally:
            # Defensive: ensure the drainer is always stopped (e.g. on an
            # unexpected error path) so no background task is orphaned.
            await streamer.aclose()
            lf.flush()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = _make_updater(context, event_queue)
        await updater.cancel()

    # -- pipeline -----------------------------------------------------------
    async def _run_read(
        self,
        task: TaskInput,
        snapshot: VerifiedSnapshot,
        on_event: Callable[[str, dict[str, Any]], None],
        tracer_event: Callable[[str, dict[str, Any]], None],
        store: AgentStateStore | None = None,
        callbacks: object | None = None,
    ) -> AgentResult:
        # The umbrella is a broad delegation entry point (gated only on the
        # universal create-agent-run permission). Real authorization is per
        # concrete capability: the read planner is shown ONLY the entitled
        # structured reads, each re-gated (Layer B) before dispatch, and the
        # free-form SQL family is offered ONLY when the caller actually holds the
        # data-layer entitlement (``data.query.select``) — otherwise the MCP
        # server would deny it. So a user with no read entitlement at all gets an
        # empty toolset and a graceful "could not determine" answer.
        decision = authorize(snapshot, SKILL_ANALYSE_READ)
        if not decision.allowed:
            tracer_event(
                "agent.task.denied",
                {"skillId": SKILL_ANALYSE_READ, "reason": decision.reason},
            )
            return AgentResult("denied", None, decision.reason, 0)
        # Project the agent's independent Layer-B allow into the security audit
        # firehose (webhook only; never the browser SSE stream).
        on_event(
            "agent.authz.allowed",
            {
                "capability": SKILL_ANALYSE_READ,
                "decision": "allow",
                "reasonCode": decision.reason,
                "actor": AGENT_NAME,
            },
        )

        def authorizer(capability_id: str) -> tuple[bool, str]:
            per_action = authorize(snapshot, capability_id)
            return per_action.allowed, per_action.reason

        sql_enabled = authorize(snapshot, SKILL_QUERY_SELECT).allowed
        data_client = self._make_data_client(task.run_id) if sql_enabled else None
        deps = GraphDeps(
            reasoner=self._reasoner,
            limits=self._limits,
            data_client=data_client,
            capability_client=self._capabilities,
            authorize=authorizer,
            sql_enabled=sql_enabled,
            on_event=on_event,
            conversation_history=_history_text(store, task.conversation_id),
            langfuse_callbacks=callbacks,
        )
        try:
            result = await run_task(task, deps)
        finally:
            if data_client is not None:
                await data_client.aclose()
        _persist_section(store, task, snapshot, SKILL_ANALYSE_READ, result)
        return result

    async def _run_write(
        self,
        task: TaskInput,
        snapshot: VerifiedSnapshot,
        on_event: Callable[[str, dict[str, Any]], None],
        tracer_event: Callable[[str, dict[str, Any]], None],
        store: AgentStateStore | None = None,
        callbacks: object | None = None,
    ) -> AgentResult:
        decision = authorize(snapshot, SKILL_ACT_WRITE, has_approval=task.approval_granted)
        if not decision.allowed:
            if decision.reason == REASON_APPROVAL_REQUIRED:
                on_event("approval.required", {"skillId": SKILL_ACT_WRITE})
                return AgentResult("needs_approval", None, REASON_APPROVAL_REQUIRED, 0)
            tracer_event(
                "agent.task.denied",
                {"skillId": SKILL_ACT_WRITE, "reason": decision.reason},
            )
            return AgentResult("denied", None, decision.reason, 0)
        on_event(
            "agent.authz.allowed",
            {
                "capability": SKILL_ACT_WRITE,
                "decision": "allow",
                "reasonCode": decision.reason,
                "actor": AGENT_NAME,
            },
        )

        def authorizer(capability_id: str) -> tuple[bool, str]:
            per_action = authorize(snapshot, capability_id)
            return per_action.allowed, per_action.reason

        deps = GraphDeps(
            reasoner=self._reasoner,
            limits=self._limits,
            capability_client=self._capabilities,
            authorize=authorizer,
            on_event=on_event,
            conversation_history=_history_text(store, task.conversation_id),
            langfuse_callbacks=callbacks,
        )
        result = await run_task(task, deps)
        _persist_section(store, task, snapshot, SKILL_ACT_WRITE, result)
        return result

    # -- A2A payload mapping ------------------------------------------------
    def _parse_task(self, context: RequestContext) -> TaskInput | None:
        message = context.message
        if message is None:
            return None
        data: dict[str, Any] = {}
        for part in get_data_parts(message.parts):
            if isinstance(part, dict):
                data.update(part)
        run_id = data.get(_KEY_RUN_ID)
        skill_id = data.get(_KEY_SKILL)
        goal = data.get(_KEY_GOAL) or context.get_user_input()
        if not isinstance(run_id, str) or not run_id:
            return None
        if not isinstance(skill_id, str) or not skill_id:
            return None
        if not isinstance(goal, str) or not goal:
            return None
        intent: Literal["read", "write"] = (
            "write" if skill_id == SKILL_ACT_WRITE else "read"
        )
        conversation_id = data.get(_KEY_CONVERSATION)
        trace_id = data.get(_KEY_LANGFUSE_TRACE)
        parent_obs = data.get(_KEY_LANGFUSE_PARENT)
        return TaskInput(
            run_id=run_id,
            correlation_id=str(data.get("correlationId", context.context_id or run_id)),
            skill_id=skill_id,
            goal=goal,
            intent=intent,
            approval_granted=bool(data.get(_KEY_APPROVAL, False)),
            conversation_id=conversation_id if isinstance(conversation_id, str) else "",
            langfuse_trace_id=trace_id if isinstance(trace_id, str) else "",
            langfuse_parent_observation_id=parent_obs if isinstance(parent_obs, str) else "",
        )

    async def _terminal(
        self,
        updater: TaskUpdater,
        status: str,
        answer: str | None,
        reason: str | None,
        events: list[dict[str, Any]] | None = None,
    ) -> None:
        # A status DataPart lets the orchestrator read the typed outcome plus the
        # ordered progress events (so the worker can stream them to the user and
        # the webhook); a text part carries the human-readable answer. The events
        # carry cataloged capability inputs/outputs but never raw SQL or rows.
        parts: list[Part] = [
            Part(
                root=DataPart(
                    data={
                        "status": status,
                        "reason": reason,
                        "answer": answer,
                        "events": events or [],
                    }
                )
            )
        ]
        if answer:
            parts.append(Part(root=TextPart(text=answer)))
        await updater.add_artifact(parts, name="result")
        message = updater.new_agent_message(
            [Part(root=TextPart(text=answer or reason or status))]
        )
        if status == "completed":
            await updater.complete(message=message)
        elif status == "needs_approval":
            await updater.requires_input(message=message)
        elif status == "denied":
            await updater.reject(message=message)
        else:
            await updater.failed(message=message)


def _attach_registrar_lifespan(app: Starlette, registrar: AgentRegistrar) -> None:
    """Run registrar start/stop via Starlette lifespan (required on Starlette 1.x)."""
    existing = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(app_instance: Starlette):
        await registrar.start()
        try:
            async with existing(app_instance) as state:
                yield state
        finally:
            await registrar.stop()

    app.router.lifespan_context = lifespan


def create_app(
    config: AgentConfig | None = None,
    *,
    reasoner: Reasoner | None = None,
    snapshot_client: SnapshotPort | None = None,
    registry_client: RegistryPort | None = None,
    resource_server: ResourceServerPort | None = None,
    data_client_factory: DataClientFactory | None = None,
    capability_client: CapabilityClient | None = None,
    registrar: AgentRegistrar | None = None,
    catalog: list[dict[str, Any]] | None = None,
) -> Starlette:
    cfg = config or load_config()

    rs: ResourceServerPort = resource_server or ResourceServer(
        jwks_uri=cfg.keycloak_jwks_uri,
        issuer_url=cfg.keycloak_issuer_url,
        audience=cfg.agent_audience,
        authorized_parties=cfg.authorized_parties,
    )
    tokens = ServiceTokenClient(
        token_url=cfg.keycloak_token_url,
        client_id=cfg.agent_client_id,
        client_secret=cfg.agent_client_secret,
        request_audience_scopes=cfg.request_audience_scopes,
    )
    sc: SnapshotPort = snapshot_client or SnapshotClient(
        tokens, base_url=cfg.nova_api_internal_url, audience_scope=cfg.mcp_audience_scope
    )
    rc: RegistryPort = registry_client or RbacRegistryClient(
        base_url=cfg.nova_api_internal_url,
        tokens=tokens,
        audience_scope=cfg.mcp_audience_scope,
    )
    make_data_client: DataClientFactory = data_client_factory or (
        lambda run_id: McpDataClient(
            base_url=cfg.db_mcp_url,
            run_id=run_id,
            tokens=tokens,
            audience_scope=cfg.mcp_audience_scope,
        )
    )
    cap_client: CapabilityClient = capability_client or HttpCapabilityClient(
        base_url=cfg.nova_api_internal_url,
        tokens=tokens,
        audience_scope=cfg.capability_audience_scope,
    )
    the_reasoner: Reasoner = reasoner or OpenAIReasoner(
        api_key=cfg.openai_api_key,
        model=cfg.llm_model,
        temperature=cfg.llm_temperature,
        timeout_s=cfg.llm_timeout_s,
        base_url=cfg.openai_base_url,
    )
    limits = GuardLimits(
        max_iterations=cfg.max_iterations,
        max_queries=cfg.max_queries,
        total_timeout_s=float(cfg.total_timeout_s),
    )

    def make_state_store(owner_subject: str) -> AgentStateStore | None:
        # Owner-scoped shared state + read-only access to the aligned history.
        # Disabled or unconfigured ⇒ the agent stays stateless/single-turn.
        if not cfg.agent_state_enabled or not cfg.redis_agent_url:
            return None
        return AgentStateStore(
            owner_subject=owner_subject,
            url=cfg.redis_agent_url,
            key_prefix=cfg.agent_state_key_prefix,
            state_ttl_s=cfg.agent_state_ttl_s,
            history_read_limit=cfg.agent_history_read_limit,
        )

    executor = SqlAnalystExecutor(
        reasoner=the_reasoner,
        snapshot_client=sc,
        registry_client=rc,
        data_client_factory=make_data_client,
        capability_client=cap_client,
        limits=limits,
        state_store_factory=make_state_store,
    )
    handler = DefaultRequestHandler(agent_executor=executor, task_store=InMemoryTaskStore())

    # Discover the curated view catalog from the DB MCP server (snapshot-free,
    # best-effort) so the card advertises the ACTUAL data surface. Tests inject
    # ``catalog`` to stay hermetic; in production None triggers the live fetch
    # (fail-soft to the static description). The SAME card is served at discovery
    # and published to the orchestrator, so both views stay consistent.
    resolved_catalog = (
        catalog
        if catalog is not None
        else fetch_catalog(
            base_url=cfg.db_mcp_url,
            tokens=tokens,
            audience_scope=cfg.mcp_audience_scope,
        )
    )
    # Load the DB-driven RBAC registry up front so the Agent Card advertises its
    # skills. ``advertised_skills`` is drift-guarded: it keeps only skills whose
    # id resolves to a real capability in the active registry, which is empty
    # until the first refresh — so without this the card ships ``skills: []`` and
    # the orchestrator rejects self-registration (no routable skills). The API is
    # a healthcheck dependency, so this normally succeeds; fail-soft (a transient
    # outage yields an empty card until the next restart) to never block serving.
    if registry_client is None:
        try:
            rc.refresh()
        except RbacRegistryError:
            logger.warning(
                "rbac registry unavailable at startup; agent card may advertise no skills"
            )

    agent_card = build_agent_card(cfg, resolved_catalog)
    a2a_app = A2AStarletteApplication(agent_card=agent_card, http_handler=handler)
    app: Starlette = a2a_app.build()

    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    app.add_route("/health", health, methods=["GET"])
    app.add_middleware(BearerAuthMiddleware, resource_server=rs)

    # Native A2A discovery: publish our card to the orchestrator on startup +
    # heartbeat (fail-soft; never blocks serving). Disabled in tests/dev via
    # config, or replaced by an injected registrar.
    the_registrar = registrar
    if the_registrar is None and cfg.registration_enabled:
        the_registrar = AgentRegistrar(
            orchestrator_url=cfg.orchestrator_internal_url,
            audience_scope=cfg.orchestrator_audience_scope,
            tokens=tokens,
            name=AGENT_NAME,
            base_url=cfg.public_url,
            audience=cfg.agent_audience,
            card=agent_card.model_dump(mode="json", by_alias=True, exclude_none=True),
            heartbeat_s=cfg.registration_heartbeat_s,
        )
    if the_registrar is not None:
        _attach_registrar_lifespan(app, the_registrar)
    return app
