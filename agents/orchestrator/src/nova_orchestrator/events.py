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

# Substrings that mark a key as carrying a credential/secret. Their VALUE is
# always replaced before an I/O payload is persisted to an event (and thus
# streamed over SSE and delivered to webhooks). Business data is preserved; only
# secrets/tokens are redacted, never logged or forwarded.
_SECRET_KEY_TOKENS: tuple[str, ...] = (
    "token",
    "secret",
    "password",
    "passwd",
    "authorization",
    "apikey",
    "api_key",
    "bearer",
    "credential",
    "cookie",
    "private_key",
    "privatekey",
    "session_id",
)
_REDACTED = "[redacted]"
# Bounds so a single tool result cannot bloat the event row / webhook body.
_MAX_STRING = 8192
_MAX_DEPTH = 8
_MAX_ITEMS = 500


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(token in lowered for token in _SECRET_KEY_TOKENS)


def safe_io(value: object, *, _depth: int = 0) -> object:
    """Return a JSON-safe, bounded, secret-redacted copy of ``value``.

    Used to attach full tool/agent call inputs and outputs to ``user`` events so
    every update is trackable end to end (SSE + webhook). Business data is kept
    verbatim; only keys that look like credentials are redacted, and strings,
    depth, and collection sizes are bounded so a payload cannot grow unbounded.
    """
    if _depth >= _MAX_DEPTH:
        return "[truncated]"
    if isinstance(value, bool) or value is None or isinstance(value, int | float):
        return value
    if isinstance(value, str):
        return value if len(value) <= _MAX_STRING else value[:_MAX_STRING] + "…"
    if isinstance(value, dict):
        safe: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= _MAX_ITEMS:
                safe["…"] = "[truncated]"
                break
            key_str = str(key)
            safe[key_str] = (
                _REDACTED if _is_secret_key(key_str) else safe_io(item, _depth=_depth + 1)
            )
        return safe
    if isinstance(value, (list, tuple)):
        items = [safe_io(item, _depth=_depth + 1) for item in list(value)[:_MAX_ITEMS]]
        if len(value) > _MAX_ITEMS:
            items.append("[truncated]")
        return items
    # Unknown / non-JSON types: surface a bounded string representation.
    text = str(value)
    return text if len(text) <= _MAX_STRING else text[:_MAX_STRING] + "…"


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
    # Every user-visibility update (not just run.completed) is mirrored to the
    # owner's webhook via the transactional outbox, so the same stream the
    # frontend sees over SSE is delivered to the configured destination. The
    # event is flushed first so the outbox row's FK references a persisted id.
    if visibility == "user":
        session.flush()
        enqueue_webhook_if_configured(session, run, event)
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
