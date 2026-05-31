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

from datetime import UTC, datetime

from celery import Task
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .authz.snapshot import EntitlementSnapshot, SnapshotIntegrityError, verify_snapshot
from .celery_app import app
from .config import load_config
from .db import get_session_factory
from .events import emit_event, record_audit, set_run_status
from .graph import execute_plan
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

    # Layers A + B + tool hops are driven by the orchestration graph.
    return execute_plan(session_factory, run_id, snapshot, gateway=gateway, max_steps=max_steps)


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
    )
    gateway = ToolGatewayClient(base_url=config.nova_api_internal_url, tokens=tokens)
    return process_run(
        get_session_factory(),
        run_id,
        entitlement_snapshot_hash,
        gateway=gateway,
        max_steps=config.max_run_steps,
    )
