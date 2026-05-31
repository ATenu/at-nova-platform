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
from collections.abc import Callable
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
    TextPart,
)
from a2a.utils import get_data_parts
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .auth.policy import authorize
from .auth.resource_server import AuthError, ResourceServer, VerifiedCaller
from .auth.snapshot import SnapshotClient, SnapshotError, VerifiedSnapshot
from .auth.tokens import ServiceTokenClient
from .authz.policy_gate import REASON_APPROVAL_REQUIRED
from .config import AgentConfig, load_config
from .harness.graph import GraphDeps, run_task
from .harness.guards import GuardLimits
from .harness.llm import OpenAIReasoner, Reasoner
from .harness.state import AgentResult, TaskInput
from .mcp.data_client import DataClient, McpDataClient
from .observability.tracing import build_tracer
from .skills import AGENT_NAME, SKILL_ACT_WRITE, SKILL_ANALYSE_READ, advertised_skills
from .tools.capability_client import CapabilityClient, HttpCapabilityClient


class ResourceServerPort(Protocol):
    """Inbound token verification seam (token + azp pinning). Fail closed."""

    def verify(self, authorization_header: str) -> VerifiedCaller: ...


class SnapshotPort(Protocol):
    """Entitlement snapshot fetch + integrity verification by run id."""

    def fetch_verified(self, run_id: str) -> VerifiedSnapshot: ...


DataClientFactory = Callable[[str], DataClient]

# Typed payload keys the orchestrator sends in the A2A message DataPart. The
# agent reads them strictly as data.
_KEY_RUN_ID = "runId"
_KEY_SKILL = "skillId"
_KEY_GOAL = "goal"
_KEY_APPROVAL = "approvalGranted"


def build_agent_card(cfg: AgentConfig) -> AgentCard:
    return AgentCard(
        name=AGENT_NAME,
        description="Read-only SQL analyst over curated, PII-aware business views.",
        version="0.1.0",
        url=cfg.public_url,
        capabilities=AgentCapabilities(streaming=False, push_notifications=False),
        default_input_modes=["text/plain", "application/json"],
        default_output_modes=["text/plain", "application/json"],
        skills=[
            AgentSkill(
                id=skill.id,
                name=skill.name,
                description=skill.description,
                tags=list(skill.intent_keywords),
            )
            for skill in advertised_skills()
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
        data_client_factory: DataClientFactory,
        capability_client: CapabilityClient,
        limits: GuardLimits,
    ) -> None:
        self._reasoner = reasoner
        self._snapshot = snapshot_client
        self._make_data_client = data_client_factory
        self._capabilities = capability_client
        self._limits = limits

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = _make_updater(context, event_queue)
        await updater.submit()
        await updater.start_work()

        task = self._parse_task(context)
        if task is None:
            await self._terminal(updater, "failed", None, "malformed_task")
            return

        tracer = build_tracer(task.run_id)
        tracer.event("agent.task.received", {"skillId": task.skill_id, "intent": task.intent})

        def on_event(event_type: str, payload: dict[str, Any]) -> None:
            tracer.event(event_type, payload)

        try:
            snapshot = await asyncio.to_thread(self._snapshot.fetch_verified, task.run_id)
        except SnapshotError:
            await self._terminal(updater, "denied", None, "entitlement_unavailable")
            return

        if task.skill_id == SKILL_ACT_WRITE:
            result = await self._run_write(task, snapshot, on_event, tracer.event)
        elif task.skill_id == SKILL_ANALYSE_READ:
            result = await self._run_read(task, snapshot, on_event, tracer.event)
        else:
            tracer.event(
                "agent.task.denied",
                {"skillId": task.skill_id, "reason": "unsupported_skill"},
            )
            await self._terminal(updater, "denied", None, "unsupported_skill")
            return

        await self._terminal(updater, result.status, result.answer, result.reason)

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
    ) -> AgentResult:
        decision = authorize(snapshot, SKILL_ANALYSE_READ)
        if not decision.allowed:
            tracer_event(
                "agent.task.denied",
                {"skillId": SKILL_ANALYSE_READ, "reason": decision.reason},
            )
            return AgentResult("denied", None, decision.reason, 0)

        data_client = self._make_data_client(task.run_id)
        deps = GraphDeps(
            reasoner=self._reasoner,
            limits=self._limits,
            data_client=data_client,
            on_event=on_event,
        )
        try:
            return await run_task(task, deps)
        finally:
            await data_client.aclose()

    async def _run_write(
        self,
        task: TaskInput,
        snapshot: VerifiedSnapshot,
        on_event: Callable[[str, dict[str, Any]], None],
        tracer_event: Callable[[str, dict[str, Any]], None],
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

        def authorizer(capability_id: str) -> tuple[bool, str]:
            per_action = authorize(snapshot, capability_id)
            return per_action.allowed, per_action.reason

        deps = GraphDeps(
            reasoner=self._reasoner,
            limits=self._limits,
            capability_client=self._capabilities,
            authorize=authorizer,
            on_event=on_event,
        )
        return await run_task(task, deps)

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
        return TaskInput(
            run_id=run_id,
            correlation_id=str(data.get("correlationId", context.context_id or run_id)),
            skill_id=skill_id,
            goal=goal,
            intent=intent,
            approval_granted=bool(data.get(_KEY_APPROVAL, False)),
        )

    async def _terminal(
        self, updater: TaskUpdater, status: str, answer: str | None, reason: str | None
    ) -> None:
        # A status DataPart lets the orchestrator read the typed outcome; a text
        # part carries the human-readable answer. Neither contains SQL/rows/PII.
        parts: list[Part] = [
            Part(root=DataPart(data={"status": status, "reason": reason, "answer": answer}))
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


def create_app(
    config: AgentConfig | None = None,
    *,
    reasoner: Reasoner | None = None,
    snapshot_client: SnapshotPort | None = None,
    resource_server: ResourceServerPort | None = None,
    data_client_factory: DataClientFactory | None = None,
    capability_client: CapabilityClient | None = None,
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

    executor = SqlAnalystExecutor(
        reasoner=the_reasoner,
        snapshot_client=sc,
        data_client_factory=make_data_client,
        capability_client=cap_client,
        limits=limits,
    )
    handler = DefaultRequestHandler(agent_executor=executor, task_store=InMemoryTaskStore())
    a2a_app = A2AStarletteApplication(agent_card=build_agent_card(cfg), http_handler=handler)
    app: Starlette = a2a_app.build()

    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    app.add_route("/health", health, methods=["GET"])
    app.add_middleware(BearerAuthMiddleware, resource_server=rs)
    return app
