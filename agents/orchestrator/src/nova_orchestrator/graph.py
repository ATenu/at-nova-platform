"""The orchestration DAG (LangGraph): autonomous reason -> dispatch -> critique.

A bounded, guarded directed graph the worker navigates by LLM judgment:

    load_context -> reason -> (tool_dispatch | agent_dispatch) -> critique ─┐
                      ▲                                                      │
                      └──────────────── continue ◀──────────────────────────┘
                                                          satisfied / budget
                                                                  │
                                                                  ▼
                                                       compose -> finalize -> END

Security invariants are preserved exactly and are NOT delegated to the LLM:
  - Layer A: the reasoner's menu is built ONLY from the verified snapshot's
    ``capability_allowlist``; it can never see or pick anything else.
  - Layer B: ``evaluate_capability`` runs in code before EVERY hop, regardless of
    the model's choice, and the Node MCP gateway / the A2A agent re-enforce it.
  - Celery discipline kept: per-run advisory lock + per-step short transactions +
    persisted ``agent_steps`` + idempotency keys + outbox events + cancellation +
    heartbeats. LangGraph only orchestrates in-memory reasoning; persistence
    stays in postgres-agents (no second checkpoint store).
  - Prompt injection: the model sees only de-identified ids/summaries; selecting
    an action is a request, not authorization.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .agent_client import AgentClient, AgentClientError, AgentEvent
from .agent_state import AgentStateStore, HistoryEntry, render_history
from .agents import AgentRegistry
from .authz.policy_gate import REASON_ALLOWED, evaluate_capability
from .authz.registry import get_capability
from .authz.snapshot import EntitlementSnapshot
from .capability_guide import CapabilityToolSpec, spec_for, tool_name_for
from .content_policy import resolve_text
from .dag import MenuItem, Observation, OrchestrationState
from .events import (
    agent_event_visibility,
    emit_event,
    record_audit,
    safe_io,
    set_run_status,
)
from .llm import Reasoner
from .models import AgentRun, AgentStep
from .observability import langfuse_tracing as lf
from .tool_gateway import ToolGatewayClient, ToolGatewayError

WORKER_ACTOR = "nova-celery-worker"
TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled", "expired"})

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StepCall:
    capability_id: str
    tool_input: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StepResult:
    """The outcome of one transactional hop. ``terminal_status`` stops the run."""

    observation: Observation | None
    terminal_status: str | None = None


@dataclass
class OrchestratorDeps:
    reasoner: Reasoner
    session_factory: sessionmaker[Session]
    run_id: str
    snapshot: EntitlementSnapshot
    gateway: ToolGatewayClient
    max_steps: int
    agent_client: AgentClient | None = None
    registry: AgentRegistry | None = None
    # Shared agent working-state + aligned conversation history (redis-agent).
    # Optional: ``None`` keeps the orchestrator stateless/single-turn as before.
    state_store: AgentStateStore | None = None
    history_read_limit: int = 20
    # DEV/TEST-ONLY: treat high-risk writes as approved (see OrchestratorConfig).
    # Default False ⇒ production behaviour is unchanged (fail closed).
    auto_approve_writes: bool = False


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return str(uuid.uuid4())


def _approval_granted(deps: OrchestratorDeps, capability_id: str) -> bool:
    """Whether a human approval is recorded/granted for this high-risk capability.

    Fails closed: a high-risk capability is denied until an approval is recorded
    for the run (recording + resume is a control-plane concern owned by the API).
    The agent independently re-checks.

    The ONLY exception is the dev/test-only ``auto_approve_writes`` escape hatch
    (``AGENT_WRITE_AUTO_APPROVE``): when explicitly enabled on a non-production
    stack it stands in for the human approval so agent writes can be exercised
    end-to-end. It is loudly logged here and additionally audited at the call
    site; it never relaxes any other gate (the concrete write capability still
    needs its own domain permission, re-checked by the Node tool gateway).
    """
    if deps.auto_approve_writes:
        logger.warning(
            "AGENT_WRITE_AUTO_APPROVE is ON: standing in for human approval of "
            "high-risk capability %s on run %s. This is a DEV/TEST-ONLY switch and "
            "MUST NOT be enabled in production.",
            capability_id,
            deps.run_id,
        )
        return True
    return False


def _required_permission_for(capability_id: str) -> str | None:
    capability = get_capability(capability_id)
    if capability is None or not capability.required_permissions:
        return None
    return "+".join(capability.required_permissions)


def _agent_dedupe_key(
    run_id: str, capability_id: str, index: int, agent_seq: int | None
) -> str | None:
    """Deterministic idempotency key for one agent sub-event.

    ``agent_seq`` is monotonic per agent task; ``capability_id`` + ``index``
    disambiguate multiple agent hops within one run. Returns ``None`` when the
    agent supplied no ordinal (then the event is emitted without dedupe).
    """
    if agent_seq is None:
        return None
    return f"{run_id}:{capability_id}:{index}:{agent_seq}"


def _emit_agent_event(
    session: Session,
    run: AgentRun,
    *,
    capability_id: str,
    index: int,
    event: AgentEvent,
) -> None:
    """Persist one agent sub-event with worker-side redaction + idempotency.

    The worker is the redaction boundary of record: ``safe_io`` runs here for
    EVERY visibility before the row is written. Visibility is classified
    centrally (``agent.node.*`` -> internal, ``agent.authz.*`` -> security, the
    rest -> user) so a streamed frame and its terminal-artifact twin land
    identically and dedupe against each other.
    """
    safe_payload = safe_io(event.payload)
    emit_event(
        session,
        run,
        event_type=event.type,
        payload=safe_payload if isinstance(safe_payload, dict) else {},
        visibility=agent_event_visibility(event.type),
        dedupe_key=_agent_dedupe_key(run.id, capability_id, index, event.agent_seq),
    )


def _lock_and_load(session: Session, run_id: str) -> AgentRun | None:
    session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": run_id})
    return session.get(AgentRun, run_id)


def _step_already_done(session: Session, run_id: str, idempotency_key: str) -> bool:
    existing = session.execute(
        select(AgentStep).where(
            AgentStep.run_id == run_id, AgentStep.idempotency_key == idempotency_key
        )
    ).scalar_one_or_none()
    return existing is not None and existing.status == "completed"


def _has_entitled_underlying(allowlist: frozenset[str], mode: str) -> bool:
    """True when the allowlist holds something the agent could act on for ``mode``.

    The orchestrator is a pure delegator: it never lists the concrete
    (``delegated``) business capabilities, but an umbrella is only worth showing
    when the user is actually entitled to at least one underlying capability the
    agent can run for that mode. For reads this is any entitled ``delegated``
    read capability OR the free-form SQL ``mcp-tool`` surface
    (``data.query.select``); for writes, any entitled ``delegated`` write
    capability.
    """
    for capability_id in allowlist:
        underlying = get_capability(capability_id)
        if underlying is None:
            continue
        if underlying.delegated and underlying.mode == mode:
            return True
        if mode == "read" and underlying.kind == "mcp-tool" and underlying.mode == "read":
            return True
    return False


def _build_menu(
    allowlist: frozenset[str], registry: AgentRegistry | None = None
) -> tuple[MenuItem, ...]:
    """Layer A: the only actions the reasoner may ever choose from (as LLM tools).

    The orchestrator is a PURE DELEGATOR, so the menu collapses to the umbrella
    delegation skills (``data.analyse.read`` / ``data.act.write``) only. The
    concrete business capabilities are ``delegated`` (agent-internal) and the
    ``mcp-tool`` capabilities are the data agents' OWN tools served by the DB MCP
    server; neither is dispatchable by the worker, so both are excluded. An
    umbrella is shown only when the user is entitled to at least one underlying
    capability of that mode (``_has_entitled_underlying``), keeping Layer A
    meaningful without ever naming a concrete capability.

    For each umbrella the agent's trusted Agent Card is the source of truth for
    the menu text: when the registry has a card entry, its description and intent
    tags drive ``summary``/``when_to_use`` so updating the card (not the
    orchestrator) changes how the skill is advertised. The curated guide
    (``spec_for``) is the fallback for the static seed path and for any skill the
    card does not describe.
    """
    items: list[MenuItem] = []
    for capability_id in sorted(allowlist):
        capability = get_capability(capability_id)
        if capability is None or capability.kind == "mcp-tool" or capability.delegated:
            continue
        if not _has_entitled_underlying(allowlist, capability.mode):
            continue
        guide = spec_for(capability_id)
        summary = guide.summary
        when_to_use = guide.when_to_use
        if registry is not None:
            card = registry.card_skill_for(capability_id)
            if card is not None and card.description:
                summary = card.description
                if card.tags:
                    when_to_use = (
                        "Use when the request relates to: " + ", ".join(card.tags) + "."
                    )
        items.append(
            MenuItem(
                capability_id=capability.id,
                kind=capability.kind,
                mode=capability.mode,
                resource_scoped=capability.resource_scoped,
                tool_name=tool_name_for(capability.id),
                summary=summary,
                when_to_use=when_to_use,
                input_fields=guide.input_fields,
            )
        )
    return tuple(items)


def build_graph(deps: OrchestratorDeps) -> CompiledStateGraph:
    menu = _build_menu(deps.snapshot.capability_allowlist, deps.registry)

    def load_context(state: OrchestrationState) -> dict[str, Any]:
        try:
            prompt = deps.gateway.get_prompt(deps.run_id)
        except ToolGatewayError:
            prompt = ""
        conversation_id = ""
        with deps.session_factory() as session:
            run = _lock_and_load(session, deps.run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return {"route": "end", "status": run.status if run else "missing"}
            conversation_id = run.conversation_id or ""
            emit_event(session, run, event_type="planner.started", payload={}, visibility="user")
            emit_event(
                session,
                run,
                event_type="planner.completed",
                payload={"menuSize": len(menu)},
                visibility="internal",
            )
            run.last_heartbeat_at = _now()
            session.commit()
        # Aligned multi-turn context from redis-agent (fail-soft, read-only here).
        history = _load_history(deps, conversation_id)
        return {
            "prompt": prompt,
            "conversation_id": conversation_id,
            "history": history,
            "iteration": 0,
            "route": "reason",
            "observations": [],
        }

    def reason(state: OrchestrationState) -> dict[str, Any]:
        iteration = int(state.get("iteration", 0))
        if iteration >= deps.max_steps:
            return {"route": "compose"}
        decision = deps.reasoner.reason(
            prompt=state.get("prompt", ""),
            menu=menu,
            observations=list(state.get("observations", [])),
            history=state.get("history", ""),
        )
        capability_id = decision.capability_id.strip()
        if decision.action == "finish" or not capability_id:
            return {"route": "compose", "decision_action": "finish"}
        tool_input = dict(decision.input)
        # Don't dispatch a scoped capability the model could not fully populate
        # (e.g. picked sales.report.customer without a customerId): finishing with
        # a clarification beats a guaranteed validation failure downstream.
        if _missing_required(spec_for(capability_id), tool_input):
            return {"route": "compose", "decision_action": "finish"}
        # No-progress guard: never re-run an identical capability+input, which
        # would otherwise burn the step budget on a loop.
        signature = _call_signature(capability_id, tool_input)
        if signature in set(state.get("attempts", [])):
            return {"route": "compose", "decision_action": "finish"}
        return {
            # Pure delegation: every menu capability is an umbrella owned by a
            # registered agent, so the only dispatch route is the A2A agent path.
            "route": "agent",
            "decision_capability": capability_id,
            "decision_input": tool_input,
            "iteration": iteration + 1,
            "attempts": [signature],
        }

    def agent_dispatch(state: OrchestrationState) -> dict[str, Any]:
        call = StepCall(
            state.get("decision_capability", ""), dict(state.get("decision_input", {}))
        )
        result = _run_agent_step(
            deps,
            call,
            int(state.get("iteration", 0)),
            state.get("prompt", ""),
            state.get("conversation_id", ""),
        )
        return _after_dispatch(result)

    def critique(state: OrchestrationState) -> dict[str, Any]:
        outcome = deps.reasoner.critique(
            prompt=state.get("prompt", ""),
            observations=list(state.get("observations", [])),
            history=state.get("history", ""),
        )
        if outcome.satisfied or not outcome.should_continue:
            return {"route": "compose"}
        if int(state.get("iteration", 0)) >= deps.max_steps:
            return {"route": "compose"}
        return {"route": "reason"}

    def compose(state: OrchestrationState) -> dict[str, Any]:
        answer = deps.reasoner.compose(
            prompt=state.get("prompt", ""),
            observations=list(state.get("observations", [])),
            history=state.get("history", ""),
        ).strip()
        return {"answer": answer or None, "route": "finalize"}

    def finalize(state: OrchestrationState) -> dict[str, Any]:
        observations = list(state.get("observations", []))
        links: list[dict[str, str]] = []
        for obs in observations:
            links.extend(obs.links)
        answer = state.get("answer") or _fallback_answer(observations)
        status = _finalize_run(deps, answer, links[:20])
        if status == "completed":
            _record_turn(
                deps,
                conversation_id=state.get("conversation_id", ""),
                prompt=state.get("prompt", ""),
                answer=answer,
                observations=observations,
            )
        return {"status": status}

    builder = StateGraph(OrchestrationState)
    builder.add_node("load_context", load_context)
    builder.add_node("reason", reason)
    builder.add_node("agent_dispatch", agent_dispatch)
    builder.add_node("critique", critique)
    builder.add_node("compose", compose)
    builder.add_node("finalize", finalize)

    builder.add_edge(START, "load_context")
    builder.add_conditional_edges(
        "load_context", _route, {"reason": "reason", "end": END}
    )
    builder.add_conditional_edges(
        "reason",
        _route,
        {"agent": "agent_dispatch", "compose": "compose"},
    )
    builder.add_conditional_edges(
        "agent_dispatch", _route, {"critique": "critique", "end": END}
    )
    builder.add_conditional_edges(
        "critique", _route, {"reason": "reason", "compose": "compose"}
    )
    builder.add_edge("compose", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile()


def _route(state: OrchestrationState) -> str:
    route = state.get("route")
    return route if isinstance(route, str) else "compose"


def _missing_required(spec: CapabilityToolSpec, tool_input: dict[str, Any]) -> list[str]:
    """Required input keys (per the tool schema) absent from the model's args."""
    required = spec.input_schema.get("required")
    if not isinstance(required, list):
        return []
    return [key for key in required if isinstance(key, str) and key not in tool_input]


def _call_signature(capability_id: str, tool_input: dict[str, Any]) -> str:
    """Stable identity of a capability call, for the no-progress guard."""
    try:
        payload = json.dumps(tool_input, sort_keys=True, default=str)
    except (TypeError, ValueError):
        payload = repr(sorted(tool_input.items()))
    return f"{capability_id}|{payload}"


def _after_dispatch(result: StepResult) -> dict[str, Any]:
    if result.terminal_status is not None:
        return {
            "route": "end",
            "status": result.terminal_status,
            "canceled": result.terminal_status == "canceled",
        }
    observations = [result.observation] if result.observation is not None else []
    return {"observations": observations, "route": "critique"}


def run_graph(
    session_factory: sessionmaker[Session],
    run_id: str,
    snapshot: EntitlementSnapshot,
    *,
    reasoner: Reasoner,
    gateway: ToolGatewayClient,
    max_steps: int,
    agent_client: AgentClient | None = None,
    registry: AgentRegistry | None = None,
    state_store: AgentStateStore | None = None,
    history_read_limit: int = 20,
    auto_approve_writes: bool = False,
) -> str:
    """Drive the run to a terminal status via the LangGraph DAG."""
    deps = OrchestratorDeps(
        reasoner=reasoner,
        session_factory=session_factory,
        run_id=run_id,
        snapshot=snapshot,
        gateway=gateway,
        max_steps=max_steps,
        agent_client=agent_client,
        registry=registry,
        state_store=state_store,
        history_read_limit=history_read_limit,
        auto_approve_writes=auto_approve_writes,
    )
    compiled = build_graph(deps)
    recursion_limit = max_steps * 4 + 8
    # One Langfuse trace per run (deterministic id, seeded from run_id). The
    # CallbackHandler is created INSIDE the root span so every LangGraph node and
    # LLM generation nests under it; tool/agent hops add their own child spans and
    # propagate this trace to the agent. Tracing is fail-soft.
    conversation_id = _conversation_id(session_factory, run_id)
    config: dict[str, Any] = {"recursion_limit": recursion_limit}
    final: dict[str, Any] = {}
    try:
        with lf.run_trace(
            run_id=run_id,
            name="orchestrator.run",
            user_id=snapshot.owner_subject,
            session_id=conversation_id,
        ):
            handler = lf.make_callback_handler()
            if handler is not None:
                config["callbacks"] = [handler]
            final = compiled.invoke(
                {"run_id": run_id, "observations": []},
                config=cast(Any, config),
            )
    finally:
        lf.flush()
    status = final.get("status")
    return status if isinstance(status, str) and status else "completed"


def _conversation_id(session_factory: sessionmaker[Session], run_id: str) -> str:
    """Best-effort read of the conversation id for the trace session (fail-soft)."""
    try:
        with session_factory() as session:
            run = session.get(AgentRun, run_id)
            return (run.conversation_id or "") if run is not None else ""
    except Exception:  # noqa: BLE001 - telemetry read must never break the run
        return ""


def _run_agent_step(
    deps: OrchestratorDeps,
    step: StepCall,
    index: int,
    prompt: str,
    conversation_id: str = "",
) -> StepResult:
    run_id = deps.run_id
    capability_id = step.capability_id
    idempotency_key = f"agent-call:{run_id}:{capability_id}:{index}"
    capability = get_capability(capability_id)
    intent = "write" if capability is not None and capability.mode == "write" else "read"
    agent = deps.registry.agent_for_skill(capability_id) if deps.registry is not None else None
    required_permission = _required_permission_for(capability_id)
    approval_granted = _approval_granted(deps, capability_id)
    # Did the dev/test escape hatch actually stand in for a human approval for a
    # high-risk capability? Used purely to audit the override loudly below.
    auto_approved = (
        approval_granted
        and deps.auto_approve_writes
        and capability is not None
        and getattr(capability, "risk", "low") == "high"
    )

    with deps.session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None or run.status in TERMINAL_STATUSES:
            return StepResult(None, run.status if run else "missing")
        if run.cancel_requested:
            set_run_status(session, run, "canceled")
            emit_event(session, run, event_type="run.canceled", payload={}, visibility="user")
            session.commit()
            return StepResult(None, "canceled")
        if _step_already_done(session, run_id, idempotency_key):
            return StepResult(Observation(capability_id, "agent", "completed"))

        decision = evaluate_capability(
            capability_id, deps.snapshot.roles, has_approval=approval_granted
        )
        if not decision.allowed:
            emit_event(
                session,
                run,
                event_type="authz.denied",
                payload={"capability": capability_id, "reason": decision.reason},
                visibility="security",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="agent.invoke",
                capability=capability_id,
                decision="deny",
                reason=decision.reason,
            )
            session.commit()
            return StepResult(
                Observation(capability_id, "agent", "denied", reason=decision.reason)
            )

        if deps.agent_client is None or agent is None:
            emit_event(
                session,
                run,
                event_type="agent.call.failed",
                payload={"capability": capability_id, "reason": "no_agent_available"},
                visibility="user",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="agent.invoke",
                capability=capability_id,
                decision="deny",
                reason="no_agent_available",
            )
            session.commit()
            return StepResult(
                Observation(capability_id, "agent", "failed", reason="no_agent_available")
            )

        # Loudly audit the dev/test auto-approval override: a high-risk write was
        # allowed WITHOUT a human approval because AGENT_WRITE_AUTO_APPROVE is on.
        # security-visibility only (never the browser SSE) + immutable audit row.
        if auto_approved:
            emit_event(
                session,
                run,
                event_type="authz.allowed",
                payload={
                    "capability": capability_id,
                    "decision": "allow",
                    "reasonCode": "auto_approved_dev_test",
                    "actor": WORKER_ACTOR,
                },
                visibility="security",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="agent.invoke",
                capability=capability_id,
                decision="allow",
                reason="auto_approved_dev_test",
            )

        # Project the orchestrator's Layer-B allow into the security audit
        # firehose (webhook only; never the browser SSE). The immutable trail is
        # still record_audit(...) on the call outcome below.
        emit_event(
            session,
            run,
            event_type="authz.allowed",
            payload={
                "capability": capability_id,
                "requiredPermission": required_permission,
                "decision": "allow",
                "reasonCode": decision.reason,
                "actor": WORKER_ACTOR,
            },
            visibility="security",
        )
        agent_step = AgentStep(
            id=_uuid(),
            run_id=run.id,
            type="agent_call",
            status="running",
            capability=capability_id,
            required_permission=required_permission,
            agent_name=agent.name,
            idempotency_key=idempotency_key,
            started_at=_now(),
        )
        session.add(agent_step)
        emit_event(
            session,
            run,
            event_type="agent.call.started",
            payload={
                "capability": capability_id,
                "agent": agent.name,
                "input": safe_io({"goal": prompt}),
            },
            visibility="user",
        )
        run.last_heartbeat_at = _now()
        session.commit()

    # Live streaming sink: each sub-event the agent pushes mid-run is persisted
    # in its OWN short transaction (no lock held across the A2A network hop) with
    # worker-side redaction + idempotency, and bumps the heartbeat so a long
    # agent call produces liveness signal throughout instead of looking idle.
    def stream_sink(event: AgentEvent) -> None:
        with deps.session_factory() as session:
            run = session.get(AgentRun, run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return
            _emit_agent_event(
                session, run, capability_id=capability_id, index=index, event=event
            )
            run.last_heartbeat_at = _now()
            session.commit()

    # External A2A hop OUTSIDE the DB transaction (no locks held during network IO).
    # Propagate the run's Langfuse trace + the current observation id so the agent
    # joins THIS trace and nests under this dispatch span (one shared context).
    error: str | None = None
    agent_result = None
    trace_id = lf.trace_id_for(run_id)
    with lf.tool_span(f"agent:{capability_id}", capability=capability_id, agent=agent.name):
        parent_observation_id = lf.current_observation_id()
        try:
            agent_result = deps.agent_client.send_task(
                base_url=agent.base_url,
                audience_scope=agent.audience_scope,
                receiver=agent.receiver,
                run_id=run_id,
                skill_id=capability_id,
                goal=prompt,
                correlation_id=run_id,
                intent=intent,
                approval_granted=approval_granted,
                conversation_id=conversation_id,
                langfuse_trace_id=trace_id,
                langfuse_parent_observation_id=parent_observation_id,
                on_event=stream_sink,
            )
        except AgentClientError as exc:
            error = f"agent_error:{exc.status_code or 'network'}"

    with deps.session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None:
            return StepResult(None, "missing")
        persisted_step = session.execute(
            select(AgentStep).where(
                AgentStep.run_id == run_id, AgentStep.idempotency_key == idempotency_key
            )
        ).scalar_one_or_none()

        if error is not None or agent_result is None:
            _mark_step_failed(persisted_step, error)
            emit_event(
                session,
                run,
                event_type="agent.call.failed",
                payload={
                    "capability": capability_id,
                    "agent": agent.name,
                    "input": safe_io({"goal": prompt}),
                    "error": error,
                },
                visibility="user",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="agent.invoke",
                capability=capability_id,
                decision="deny" if error == "agent_error:403" else "allow",
                reason=error,
            )
            run.last_heartbeat_at = _now()
            session.commit()
            return StepResult(
                Observation(capability_id, "agent", "failed", reason=error)
            )

        # Reconcile / backfill: the terminal artifact carries the full ordered
        # sub-event list. Anything already streamed live is skipped by its
        # dedupe key (idempotent insert); anything the stream missed (dropped
        # frame, batch-mode agent, reconnect gap) is filled in here. Payloads are
        # redacted + bounded by the worker; the agent never returns raw SQL/rows.
        for event in agent_result.events:
            _emit_agent_event(
                session, run, capability_id=capability_id, index=index, event=event
            )

        if agent_result.status == "completed":
            summary = agent_result.answer or ""
            links = [
                {"label": link["label"], "href": link["href"], "type": "external"}
                for link in agent_result.links
            ]
            if persisted_step is not None:
                persisted_step.status = "completed"
                persisted_step.completed_at = _now()
                session.add(persisted_step)
            emit_event(
                session,
                run,
                event_type="agent.call.completed",
                payload={
                    "capability": capability_id,
                    "agent": agent.name,
                    "output": safe_io({"answer": summary}),
                },
                visibility="user",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="agent.invoke",
                capability=capability_id,
                decision="allow",
                reason=REASON_ALLOWED,
            )
            run.last_heartbeat_at = _now()
            session.commit()
            return StepResult(
                Observation(capability_id, "agent", "completed", summary=summary, links=links)
            )

        reason_text = agent_result.reason or agent_result.status
        _mark_step_failed(persisted_step, reason_text)
        emit_event(
            session,
            run,
            event_type="agent.call.failed",
            payload={
                "capability": capability_id,
                "agent": agent.name,
                "input": safe_io({"goal": prompt}),
                "reason": reason_text,
            },
            visibility="user",
        )
        record_audit(
            session,
            run_id=run.id,
            owner_subject=run.owner_subject,
            actor=WORKER_ACTOR,
            action="agent.invoke",
            capability=capability_id,
            decision="deny",
            reason=reason_text,
        )
        run.last_heartbeat_at = _now()
        session.commit()
        status = "needs_approval" if agent_result.status == "needs_approval" else "failed"
        return StepResult(
            Observation(capability_id, "agent", status, reason=reason_text)
        )


def _mark_step_failed(persisted_step: AgentStep | None, error_code: str | None) -> None:
    if persisted_step is not None:
        persisted_step.status = "failed"
        persisted_step.completed_at = _now()
        persisted_step.error_code = error_code


def _finalize_run(
    deps: OrchestratorDeps, answer: str, links: list[dict[str, str]]
) -> str:
    try:
        deps.gateway.finalize(deps.run_id, answer, links)
    except ToolGatewayError:
        # Non-fatal: the run still completes; the message can be re-derived from
        # events. Never fail a successful run on a finalize transport hiccup.
        pass

    with deps.session_factory() as session:
        run = _lock_and_load(session, deps.run_id)
        if run is None or run.status in TERMINAL_STATUSES:
            return run.status if run else "missing"
        set_run_status(session, run, "completed")
        # emit_event enqueues the webhook for every user event (incl. this one).
        emit_event(session, run, event_type="run.completed", payload={}, visibility="user")
        run.last_heartbeat_at = _now()
        session.commit()
    return "completed"


def _load_history(deps: OrchestratorDeps, conversation_id: str) -> str:
    """Read prior turns from redis-agent and render them for prompt grounding.

    Fail-soft: any store error yields an empty block, so the run proceeds exactly
    as it does today when no shared state is configured.
    """
    if deps.state_store is None or not conversation_id:
        return ""
    entries = deps.state_store.read_history(
        conversation_id, limit=deps.history_read_limit
    )
    return render_history(entries)


def _record_turn(
    deps: OrchestratorDeps,
    *,
    conversation_id: str,
    prompt: str,
    answer: str,
    observations: list[Observation],
) -> None:
    """Append the user + assistant turn to the aligned conversation history.

    The orchestrator is the SINGLE writer of history (consistency). Content is
    entitlement-gated: the user's own prompt and the composed answer (grounded
    only in capabilities the owner was entitled to run) are stored in full — no
    PII redaction for an entitled owner — while secrets are always stripped.
    """
    store = deps.state_store
    if store is None or not conversation_id:
        return
    run_id = deps.run_id
    snapshot = deps.snapshot
    user_text = resolve_text(prompt, snapshot=snapshot)
    store.append_history(
        conversation_id,
        HistoryEntry(role="user", content=user_text, run_id=run_id),
    )
    store.append_history(
        conversation_id,
        HistoryEntry(role="assistant", content=resolve_text(answer, snapshot=snapshot),
                     run_id=run_id),
    )
    # The orchestrator's own per-run section: a de-identified trace of what ran.
    store.write_section(
        run_id,
        "orchestrator",
        {
            "observations": [
                {"capability": obs.capability_id, "status": obs.status, "summary": obs.summary}
                for obs in observations
            ],
            "answer": resolve_text(answer, snapshot=snapshot),
        },
    )


def _fallback_answer(observations: list[Observation]) -> str:
    if any(obs.status == "completed" for obs in observations):
        return "Completed the requested actions."
    return (
        "I could not map your request to an action you are entitled to run, or a "
        "required detail was missing. Please rephrase or include any needed record id."
    )
