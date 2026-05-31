"""The Celery orchestration task and its idempotent, resumable core.

Execution pattern (plan section 8):
  1. serialize per-run work with a Postgres advisory lock (distributed lock);
  2. load run state; if already terminal, return (idempotent on redelivery);
  3. load + verify the entitlement snapshot (hash + expiry) — FAIL CLOSED;
  4. honour cancellation;
  5. run the code policy gate (Layer A planner filter + Layer B authoritative
     gate) before any hop;
  6. persist each state transition with its outbox event in one transaction.

No secret, token, or PII is placed in task payloads, events, or logs.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from celery import Task
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .agent_client import AgentClient
from .agent_state import AgentStateStore
from .agents import AgentRegistry, build_default_registry
from .authz.snapshot import EntitlementSnapshot, SnapshotIntegrityError, verify_snapshot
from .celery_app import app
from .config import load_config
from .db import get_session_factory
from .events import emit_event, record_audit, set_run_status
from .graph import run_graph
from .llm import OpenAIReasoner, Reasoner
from .models import AgentRun, AgentRunEntitlement
from .tokens import ServiceTokenClient
from .tool_gateway import ToolGatewayClient

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled", "expired"})
WORKER_ACTOR = "nova-celery-worker"


def _load_snapshot(session: Session, entitlement: AgentRunEntitlement) -> EntitlementSnapshot:
    return EntitlementSnapshot(
        owner_subject=entitlement.owner_subject,
        owner_user_id=entitlement.owner_user_id,
        roles=tuple(entitlement.roles),
        permissions=frozenset(entitlement.permissions),
        capability_allowlist=frozenset(entitlement.capability_allowlist),
        snapshot_hash=entitlement.snapshot_hash,
        issued_at=entitlement.issued_at,
        expires_at=entitlement.expires_at,
    )


def process_run(
    session_factory: sessionmaker[Session],
    run_id: str,
    expected_hash: str,
    *,
    gateway: ToolGatewayClient | None = None,
    max_steps: int = 8,
    agent_client: AgentClient | None = None,
    registry: AgentRegistry | None = None,
    reasoner: Reasoner | None = None,
    state_store_factory: Callable[[str], AgentStateStore | None] | None = None,
    history_read_limit: int = 20,
) -> str:
    """Process a run to a terminal status and return that status.

    Pure of Celery so it is unit/integration testable on its own. The
    verification + state transition happen under a per-run advisory lock; the
    capability hops are then driven by the orchestration graph (each in its own
    short transaction so progress streams live). When ``gateway`` is ``None`` no
    external hops are possible, so the run completes immediately after the
    secure foundation (snapshot verification + state transition) is exercised.
    """
    with session_factory() as session:
        # Distributed lock: serialize concurrent processing of the same run.
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": run_id}
        )

        run = session.get(AgentRun, run_id)
        if run is None:
            return "missing"
        if run.status in TERMINAL_STATUSES:
            return run.status

        entitlement = session.execute(
            select(AgentRunEntitlement).where(
                AgentRunEntitlement.id == run.entitlement_snapshot_id
            )
        ).scalar_one_or_none()

        if entitlement is None:
            return _fail_closed(session, run, reason="entitlement_missing")

        snapshot = _load_snapshot(session, entitlement)
        try:
            verify_snapshot(snapshot, expected_hash=expected_hash)
        except SnapshotIntegrityError as exc:
            return _fail_closed(session, run, reason=str(exc))

        if run.cancel_requested:
            set_run_status(session, run, "canceled")
            emit_event(session, run, event_type="run.canceled", payload={}, visibility="user")
            session.commit()
            return "canceled"

        set_run_status(session, run, "accepted")
        emit_event(session, run, event_type="run.accepted", payload={}, visibility="user")
        set_run_status(session, run, "running")
        emit_event(session, run, event_type="run.started", payload={}, visibility="user")
        run.last_heartbeat_at = datetime.now(UTC)
        session.commit()

    if gateway is None:
        # No execution channel configured: complete after the secure foundation.
        with session_factory() as session:
            session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": run_id}
            )
            run = session.get(AgentRun, run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return run.status if run else "missing"
            set_run_status(session, run, "completed")
            emit_event(session, run, event_type="run.completed", payload={}, visibility="user")
            session.commit()
        return "completed"

    # Layers A + B + tool/agent hops are driven by the LangGraph orchestration
    # DAG. The reasoner is required for the graph; fail closed if it is missing.
    if reasoner is None:
        with session_factory() as session:
            session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": run_id}
            )
            run = session.get(AgentRun, run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return run.status if run else "missing"
            return _fail_closed(session, run, reason="reasoner_unavailable")
    state_store = (
        state_store_factory(snapshot.owner_subject) if state_store_factory is not None else None
    )
    return run_graph(
        session_factory,
        run_id,
        snapshot,
        reasoner=reasoner,
        gateway=gateway,
        max_steps=max_steps,
        agent_client=agent_client,
        registry=registry,
        state_store=state_store,
        history_read_limit=history_read_limit,
    )


def _fail_closed(session: Session, run: AgentRun, *, reason: str) -> str:
    # security-visibility event; never streamed to the end user.
    emit_event(
        session,
        run,
        event_type="authz.denied",
        payload={"reason": reason},
        visibility="security",
    )
    record_audit(
        session,
        run_id=run.id,
        owner_subject=run.owner_subject,
        actor=WORKER_ACTOR,
        action="snapshot.verify",
        decision="deny",
        reason=reason,
    )
    set_run_status(session, run, "failed")
    session.commit()
    return "failed"


@app.task(
    bind=True,
    name="orchestrator.run",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=5,
)
def run_orchestration(
    self: Task,
    run_id: str,
    request_id: str,
    idempotency_key: str,
    entitlement_snapshot_id: str,
    entitlement_snapshot_hash: str,
) -> str:
    """Celery entrypoint. Thin wrapper over the testable ``process_run`` core."""
    config = load_config()
    tokens = ServiceTokenClient(
        token_url=config.keycloak_token_url,
        client_id=config.worker_client_id,
        client_secret=config.worker_client_secret,
        request_audience_scopes=config.worker_request_audience_scopes,
    )
    gateway = ToolGatewayClient(base_url=config.nova_api_internal_url, tokens=tokens)
    agent_client = AgentClient(
        tokens=tokens, timeout_s=config.agent_request_timeout_s
    )
    registry = build_default_registry(config)
    reasoner: Reasoner = OpenAIReasoner(
        api_key=config.openai_api_key,
        model=config.llm_model,
        temperature=config.llm_temperature,
        timeout_s=config.llm_timeout_s,
        base_url=config.openai_base_url,
    )

    def state_store_factory(owner_subject: str) -> AgentStateStore | None:
        # Owner-scoped shared working state + aligned history (redis-agent).
        # Disabled or unconfigured ⇒ the run stays stateless/single-turn.
        if not config.agent_state_enabled or not config.redis_agent_url:
            return None
        return AgentStateStore(
            owner_subject=owner_subject,
            url=config.redis_agent_url,
            key_prefix=config.agent_state_key_prefix,
            state_ttl_s=config.agent_state_ttl_s,
            history_ttl_s=config.agent_history_ttl_s,
            history_max_entries=config.agent_history_max_entries,
        )

    return process_run(
        get_session_factory(),
        run_id,
        entitlement_snapshot_hash,
        gateway=gateway,
        max_steps=config.max_run_steps,
        agent_client=agent_client,
        registry=registry,
        reasoner=reasoner,
        state_store_factory=state_store_factory,
        history_read_limit=config.agent_history_read_limit,
    )
