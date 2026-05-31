"""The orchestration graph: plan -> per-hop policy gate -> tool call -> finalize.

This is an explicit, typed state machine (not uncontrolled recursion) with the
guardrails the engineering skill requires: typed state, validated node outputs,
bounded iteration (``max_run_steps``), cancellation between steps, heartbeats,
and per-step idempotency. Every hop passes the authoritative Layer B policy gate
(``evaluate_capability``) before the tool is invoked, and the Node MCP gateway
independently re-enforces the same decision (defense in depth).

Each step runs in its OWN short transaction (re-acquiring the per-run advisory
lock) so progress events stream live and a crash never loses committed state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .authz.policy_gate import REASON_ALLOWED, evaluate_capability
from .authz.registry import get_capability
from .authz.snapshot import EntitlementSnapshot
from .events import emit_event, enqueue_webhook_if_configured, record_audit, set_run_status
from .models import AgentRun, AgentStep
from .planner import Plan, PlannedStep, plan
from .tool_gateway import ToolGatewayClient, ToolGatewayError

WORKER_ACTOR = "nova-celery-worker"
TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled", "expired"})


@dataclass
class StepOutcome:
    summary: str
    links: list[dict[str, str]]


def _now() -> datetime:
    return datetime.now(UTC)


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


def execute_plan(
    session_factory: sessionmaker[Session],
    run_id: str,
    snapshot: EntitlementSnapshot,
    *,
    gateway: ToolGatewayClient,
    max_steps: int,
) -> str:
    """Drive the run to a terminal status. Returns the final status string."""
    allowed = set(snapshot.capability_allowlist)

    # Fetch the prompt over the authenticated tool-gateway channel (never from
    # the broker). Plan against only the allowed capabilities (Layer A).
    try:
        prompt = gateway.get_prompt(run_id)
    except ToolGatewayError:
        prompt = ""

    the_plan: Plan = plan(prompt, allowed)
    outcomes: list[StepOutcome] = []

    with session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None or run.status in TERMINAL_STATUSES:
            return run.status if run else "missing"
        emit_event(session, run, event_type="planner.started", payload={}, visibility="user")
        emit_event(
            session,
            run,
            event_type="planner.completed",
            payload={"plannedSteps": len(the_plan.steps)},
            visibility="internal",
        )
        run.last_heartbeat_at = _now()
        session.commit()

    for index, step in enumerate(the_plan.steps[:max_steps]):
        status = _run_one_step(session_factory, run_id, snapshot, step, index, gateway, outcomes)
        if status == "canceled":
            return status

    return _finalize(session_factory, run_id, the_plan, outcomes, gateway)


def _run_one_step(
    session_factory: sessionmaker[Session],
    run_id: str,
    snapshot: EntitlementSnapshot,
    step: PlannedStep,
    index: int,
    gateway: ToolGatewayClient,
    outcomes: list[StepOutcome],
) -> str:
    idempotency_key = f"tool-call:{run_id}:{step.capability_id}:{index}"
    with session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None or run.status in TERMINAL_STATUSES:
            return run.status if run else "missing"
        if run.cancel_requested:
            set_run_status(session, run, "canceled")
            emit_event(session, run, event_type="run.canceled", payload={}, visibility="user")
            session.commit()
            return "canceled"
        if _step_already_done(session, run_id, idempotency_key):
            return "running"

        # Layer B — authoritative, default-deny gate before the hop.
        decision = evaluate_capability(step.capability_id, snapshot.roles)
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
            return "running"

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

    with session_factory() as session:
        run = _lock_and_load(session, run_id)
        if run is None:
            return "missing"
        persisted_step = session.execute(
            select(AgentStep).where(
                AgentStep.run_id == run_id, AgentStep.idempotency_key == idempotency_key
            )
        ).scalar_one_or_none()
        if error is not None or result is None:
            if persisted_step is not None:
                persisted_step.status = "failed"
                persisted_step.completed_at = _now()
                persisted_step.error_code = error
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
        else:
            summary = str(result.get("summary", ""))
            links = _coerce_links(result.get("links"))
            outcomes.append(StepOutcome(summary=summary, links=links))
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
    return "running"


def _finalize(
    session_factory: sessionmaker[Session],
    run_id: str,
    the_plan: Plan,
    outcomes: list[StepOutcome],
    gateway: ToolGatewayClient,
) -> str:
    text_body = _compose_response(the_plan, outcomes)
    links: list[dict[str, str]] = []
    for outcome in outcomes:
        links.extend(outcome.links)

    # Persist the final assistant message via the control plane (business DB).
    try:
        gateway.finalize(run_id, text_body, links[:20])
    except ToolGatewayError:
        # Non-fatal: the run still completes; the message can be re-derived from
        # events. Never fail a successful run on a finalize transport hiccup.
        pass

    with session_factory() as session:
        run = _lock_and_load(session, run_id)
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


def _compose_response(the_plan: Plan, outcomes: list[StepOutcome]) -> str:
    if outcomes:
        lines = [outcome.summary for outcome in outcomes if outcome.summary]
        body = " ".join(lines) if lines else "Completed the requested actions."
    elif the_plan.skipped_for_missing_input:
        body = (
            "I can run that, but I need a specific record id (e.g. a customer id) "
            "to proceed. Please include it and try again."
        )
    else:
        body = (
            "I could not map your request to an action you are entitled to run. "
            "Try asking for a customer sales report, pending issues, the next "
            "action, or an SOP."
        )
    return body


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


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())
