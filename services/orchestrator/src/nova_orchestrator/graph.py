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

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .agent_client import AgentClient, AgentClientError
from .agents import AgentRegistry
from .authz.policy_gate import REASON_ALLOWED, evaluate_capability
from .authz.registry import get_capability
from .authz.snapshot import EntitlementSnapshot
from .dag import MenuItem, Observation, OrchestrationState
from .events import emit_event, enqueue_webhook_if_configured, record_audit, set_run_status
from .llm import Reasoner
from .models import AgentRun, AgentStep
from .tool_gateway import ToolGatewayClient, ToolGatewayError

WORKER_ACTOR = "nova-celery-worker"
TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled", "expired"})


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


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return str(uuid.uuid4())


def _approval_granted(run_id: str, capability_id: str) -> bool:
    """Whether a human approval is recorded for this high-risk capability.

    Fails closed: a high-risk capability is denied until an approval is recorded
    for the run (recording + resume is a control-plane concern owned by the API).
    The agent independently re-checks.
    """
    return False


def _required_permission_for(capability_id: str) -> str | None:
    capability = get_capability(capability_id)
    if capability is None or not capability.required_permissions:
        return None
    return "+".join(capability.required_permissions)


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


def _build_menu(allowlist: frozenset[str]) -> tuple[MenuItem, ...]:
    """Layer A: the only actions the reasoner may ever choose from."""
    items: list[MenuItem] = []
    for capability_id in sorted(allowlist):
        capability = get_capability(capability_id)
        if capability is None:
            continue
        items.append(
            MenuItem(
                capability_id=capability.id,
                kind=capability.kind,
                mode=capability.mode,
                resource_scoped=capability.resource_scoped,
            )
        )
    return tuple(items)


def build_graph(deps: OrchestratorDeps) -> CompiledStateGraph[Any, Any, Any, Any]:
    menu = _build_menu(deps.snapshot.capability_allowlist)

    def load_context(state: OrchestrationState) -> dict[str, Any]:
        try:
            prompt = deps.gateway.get_prompt(deps.run_id)
        except ToolGatewayError:
            prompt = ""
        with deps.session_factory() as session:
            run = _lock_and_load(session, deps.run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return {"route": "end", "status": run.status if run else "missing"}
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
        return {"prompt": prompt, "iteration": 0, "route": "reason", "observations": []}

    def reason(state: OrchestrationState) -> dict[str, Any]:
        iteration = int(state.get("iteration", 0))
        if iteration >= deps.max_steps:
            return {"route": "compose"}
        decision = deps.reasoner.reason(
            prompt=state.get("prompt", ""),
            menu=menu,
            observations=list(state.get("observations", [])),
        )
        capability_id = decision.capability_id.strip()
        if decision.action == "finish" or not capability_id:
            return {"route": "compose", "decision_action": "finish"}
        return {
            "route": _route_for_capability(capability_id),
            "decision_capability": capability_id,
            "decision_input": dict(decision.input),
            "iteration": iteration + 1,
        }

    def tool_dispatch(state: OrchestrationState) -> dict[str, Any]:
        call = StepCall(state.get("decision_capability", ""), dict(state.get("decision_input", {})))
        result = _run_tool_step(deps, call, int(state.get("iteration", 0)))
        return _after_dispatch(result)

    def agent_dispatch(state: OrchestrationState) -> dict[str, Any]:
        call = StepCall(
            state.get("decision_capability", ""), dict(state.get("decision_input", {}))
        )
        result = _run_agent_step(
            deps, call, int(state.get("iteration", 0)), state.get("prompt", "")
        )
        return _after_dispatch(result)

    def critique(state: OrchestrationState) -> dict[str, Any]:
        outcome = deps.reasoner.critique(
            prompt=state.get("prompt", ""), observations=list(state.get("observations", []))
        )
        if outcome.satisfied or not outcome.should_continue:
            return {"route": "compose"}
        if int(state.get("iteration", 0)) >= deps.max_steps:
            return {"route": "compose"}
        return {"route": "reason"}

    def compose(state: OrchestrationState) -> dict[str, Any]:
        answer = deps.reasoner.compose(
            prompt=state.get("prompt", ""), observations=list(state.get("observations", []))
        ).strip()
        return {"answer": answer or None, "route": "finalize"}

    def finalize(state: OrchestrationState) -> dict[str, Any]:
        observations = list(state.get("observations", []))
        links: list[dict[str, str]] = []
        for obs in observations:
            links.extend(obs.links)
        answer = state.get("answer") or _fallback_answer(observations)
        status = _finalize_run(deps, answer, links[:20])
        return {"status": status}

    builder = StateGraph(OrchestrationState)
    builder.add_node("load_context", load_context)
    builder.add_node("reason", reason)
    builder.add_node("tool_dispatch", tool_dispatch)
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
        {"tool": "tool_dispatch", "agent": "agent_dispatch", "compose": "compose"},
    )
    builder.add_conditional_edges(
        "tool_dispatch", _route, {"critique": "critique", "end": END}
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


def _route_for_capability(capability_id: str) -> str:
    """Dispatch a cataloged agent-skill via A2A; everything else via the tool gateway."""
    capability = get_capability(capability_id)
    return "agent" if capability is not None and capability.kind == "agent-skill" else "tool"


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
    )
    compiled = build_graph(deps)
    recursion_limit = max_steps * 4 + 8
    final: dict[str, Any] = compiled.invoke(
        {"run_id": run_id, "observations": []},
        config={"recursion_limit": recursion_limit},
    )
    status = final.get("status")
    return status if isinstance(status, str) and status else "completed"


def _run_tool_step(deps: OrchestratorDeps, step: StepCall, index: int) -> StepResult:
    run_id = deps.run_id
    gateway = deps.gateway
    idempotency_key = f"tool-call:{run_id}:{step.capability_id}:{index}"
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
            return StepResult(Observation(step.capability_id, "tool", "completed"))

        decision = evaluate_capability(step.capability_id, deps.snapshot.roles)
        required_permission = _required_permission_for(step.capability_id)
        if not decision.allowed:
            emit_event(
                session,
                run,
                event_type="authz.denied",
                payload={"capability": step.capability_id, "reason": decision.reason},
                visibility="security",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="tool.invoke",
                capability=step.capability_id,
                decision="deny",
                reason=decision.reason,
            )
            session.commit()
            return StepResult(
                Observation(step.capability_id, "tool", "denied", reason=decision.reason)
            )

        agent_step = AgentStep(
            id=_uuid(),
            run_id=run.id,
            type="tool_call",
            status="running",
            capability=step.capability_id,
            required_permission=required_permission,
            tool_name=step.capability_id,
            idempotency_key=idempotency_key,
            started_at=_now(),
        )
        session.add(agent_step)
        emit_event(
            session,
            run,
            event_type="tool.call.started",
            payload={"capability": step.capability_id},
            visibility="user",
        )
        run.last_heartbeat_at = _now()
        session.commit()

    # External hop OUTSIDE the DB transaction (no DB locks held during network IO).
    error: str | None = None
    result: dict[str, Any] | None = None
    try:
        result = gateway.execute_capability(run_id, step.capability_id, step.tool_input)
    except ToolGatewayError as exc:
        error = f"tool_gateway_error:{exc.status_code or 'network'}"

    with deps.session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None:
            return StepResult(None, "missing")
        persisted_step = session.execute(
            select(AgentStep).where(
                AgentStep.run_id == run_id, AgentStep.idempotency_key == idempotency_key
            )
        ).scalar_one_or_none()
        if error is not None or result is None:
            _mark_step_failed(persisted_step, error)
            if persisted_step is not None:
                session.add(persisted_step)
            emit_event(
                session,
                run,
                event_type="tool.call.failed",
                payload={"capability": step.capability_id},
                visibility="user",
            )
            record_audit(
                session,
                run_id=run.id,
                owner_subject=run.owner_subject,
                actor=WORKER_ACTOR,
                action="tool.invoke",
                capability=step.capability_id,
                decision="deny" if error == "tool_gateway_error:403" else "allow",
                reason=error,
            )
            run.last_heartbeat_at = _now()
            session.commit()
            return StepResult(
                Observation(step.capability_id, "tool", "failed", reason=error)
            )
        summary = str(result.get("summary", ""))
        links = _coerce_links(result.get("links"))
        if persisted_step is not None:
            persisted_step.status = "completed"
            persisted_step.completed_at = _now()
            session.add(persisted_step)
        emit_event(
            session,
            run,
            event_type="tool.call.completed",
            payload={"capability": step.capability_id, "summary": summary},
            visibility="user",
        )
        record_audit(
            session,
            run_id=run.id,
            owner_subject=run.owner_subject,
            actor=WORKER_ACTOR,
            action="tool.invoke",
            capability=step.capability_id,
            decision="allow",
            reason=REASON_ALLOWED,
        )
        run.last_heartbeat_at = _now()
        session.commit()
    return StepResult(
        Observation(step.capability_id, "tool", "completed", summary=summary, links=links)
    )


def _run_agent_step(
    deps: OrchestratorDeps, step: StepCall, index: int, prompt: str
) -> StepResult:
    run_id = deps.run_id
    capability_id = step.capability_id
    idempotency_key = f"agent-call:{run_id}:{capability_id}:{index}"
    capability = get_capability(capability_id)
    intent = "write" if capability is not None and capability.mode == "write" else "read"
    agent = deps.registry.agent_for_skill(capability_id) if deps.registry is not None else None
    required_permission = _required_permission_for(capability_id)
    approval_granted = _approval_granted(run_id, capability_id)

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
            payload={"capability": capability_id, "agent": agent.name},
            visibility="user",
        )
        run.last_heartbeat_at = _now()
        session.commit()

    # External A2A hop OUTSIDE the DB transaction (no locks held during network IO).
    error: str | None = None
    agent_result = None
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
                payload={"capability": capability_id, "agent": agent.name},
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

        # Normalize the agent's own progress events into the run stream (internal).
        for event in agent_result.events:
            emit_event(
                session,
                run,
                event_type=event.type,
                payload=_safe_event_payload(event.payload),
                visibility="internal",
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
                payload={"capability": capability_id, "agent": agent.name},
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
            payload={"capability": capability_id, "reason": reason_text},
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


def _safe_event_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep only safe primitives from an agent-provided event payload."""
    safe: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, bool | int | float | str) or value is None:
            safe[key] = value
    return safe


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
        completed = emit_event(
            session, run, event_type="run.completed", payload={}, visibility="user"
        )
        session.flush()
        enqueue_webhook_if_configured(session, run, completed)
        run.last_heartbeat_at = _now()
        session.commit()
    return "completed"


def _fallback_answer(observations: list[Observation]) -> str:
    if any(obs.status == "completed" for obs in observations):
        return "Completed the requested actions."
    return (
        "I could not map your request to an action you are entitled to run, or a "
        "required detail was missing. Please rephrase or include any needed record id."
    )


def _coerce_links(value: object) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                label = item.get("label")
                href = item.get("href")
                link_type = item.get("type")
                if isinstance(label, str) and isinstance(href, str) and isinstance(link_type, str):
                    links.append({"label": label, "href": href, "type": link_type})
    return links
