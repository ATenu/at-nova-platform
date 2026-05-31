"""Outbox writers: progress events, audit rows, and run-state transitions.

Events and the state change they describe are written in the same DB
transaction (transactional outbox) so nothing is lost on a worker crash. Only
``user``-visibility events are ever streamed to the end user; ``internal`` and
``security`` events (e.g. ``authz.denied``) never leave the backend.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
    AgentAuditLog,
    AgentRun,
    AgentRunEvent,
    WebhookAuthConfig,
    WebhookDelivery,
)

Visibility = str  # "user" | "internal" | "security"


def _now() -> datetime:
    return datetime.now(UTC)


def next_sequence(session: Session, run_id: str) -> int:
    current = session.execute(
        select(func.coalesce(func.max(AgentRunEvent.sequence), 0)).where(
            AgentRunEvent.run_id == run_id
        )
    ).scalar_one()
    return int(current) + 1


def emit_event(
    session: Session,
    run: AgentRun,
    *,
    event_type: str,
    payload: dict[str, Any],
    visibility: Visibility,
) -> AgentRunEvent:
    event = AgentRunEvent(
        id=str(uuid.uuid4()),
        run_id=run.id,
        owner_subject=run.owner_subject,
        sequence=next_sequence(session, run.id),
        type=event_type,
        payload=payload,
        visibility=visibility,
        created_at=_now(),
    )
    session.add(event)
    return event


def record_audit(
    session: Session,
    *,
    run_id: str | None,
    owner_subject: str | None,
    actor: str,
    action: str,
    decision: str,
    capability: str | None = None,
    reason: str | None = None,
    correlation_id: str | None = None,
) -> None:
    session.add(
        AgentAuditLog(
            id=str(uuid.uuid4()),
            run_id=run_id,
            owner_subject=owner_subject,
            actor=actor,
            action=action,
            capability=capability,
            decision=decision,
            reason=reason,
            correlation_id=correlation_id,
            created_at=_now(),
        )
    )


def set_run_status(session: Session, run: AgentRun, status: str) -> None:
    run.status = status
    run.updated_at = _now()
    session.add(run)


def enqueue_webhook_if_configured(
    session: Session, run: AgentRun, event: AgentRunEvent
) -> WebhookDelivery | None:
    """Write a webhook outbox row for ``event`` IF the owner has an active config.

    Called in the SAME transaction as the event it describes (transactional
    outbox): a separate dispatcher claims and sends pending rows. The unique
    (event_id, destination_url) index makes re-enqueue idempotent.
    """
    config = session.execute(
        select(WebhookAuthConfig).where(
            WebhookAuthConfig.owner_subject == run.owner_subject,
            WebhookAuthConfig.active.is_(True),
        )
    ).scalar_one_or_none()
    if config is None:
        return None

    delivery = WebhookDelivery(
        id=str(uuid.uuid4()),
        run_id=run.id,
        event_id=event.id,
        owner_subject=run.owner_subject,
        destination_url=config.destination_url,
        auth_config_id=config.id,
        status="pending",
        attempt_count=0,
        next_attempt_at=_now(),
        created_at=_now(),
    )
    session.add(delivery)
    return delivery
