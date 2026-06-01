"""Outbox writers: progress events, audit rows, and run-state transitions.

Events and the state change they describe are written in the same DB
transaction (transactional outbox) so nothing is lost on a worker crash.

Two channels are fed from this one ordered ledger:

- the **browser SSE** stream is ``user``-only (the API filters ``visibility =
  'user'``); ``internal``/``security`` events (e.g. ``authz.*``) never leave the
  backend over SSE;
- the **owner webhook** is an authenticated server-to-server audit channel that
  may additionally receive ``internal`` + ``security`` events, scoped by the
  owner's :class:`WebhookAuthConfig` (``visibility_scope`` /
  ``event_type_allowlist``). The default scope is the full firehose.

Agent sub-events carry a deterministic ``dedupe_key`` so a live streamed frame
and its terminal-artifact twin (or a reconnect replay) never produce duplicate
rows; the DB enforces this via a unique partial index.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .models import (
    AgentAuditLog,
    AgentRun,
    AgentRunEvent,
    WebhookAuthConfig,
    WebhookDelivery,
)

Visibility = str  # "user" | "internal" | "security"

# Default webhook firehose scope: every visibility (opt-out, not opt-in).
DEFAULT_VISIBILITY_SCOPE: tuple[Visibility, ...] = ("user", "internal", "security")

# Agent-internal event types that must NOT reach the browser SSE stream. Node
# execution markers are operational telemetry (``internal``); the agent's own
# Layer-B RBAC decision projections are ``security`` (webhook audit only — never
# hand authz reason codes to the client, which aids permission probing).
_AGENT_SECURITY_EVENT_TYPES: frozenset[str] = frozenset(
    {"agent.authz.allowed", "agent.authz.denied"}
)


def agent_event_visibility(event_type: str) -> Visibility:
    """Classify an agent-emitted sub-event into its ledger visibility.

    Single source of truth used by BOTH the live streaming consumer and the
    terminal-artifact reconcile pass so an event lands with the same visibility
    no matter which path persists it first.
    """
    if event_type.startswith("agent.node."):
        return "internal"
    if event_type in _AGENT_SECURITY_EVENT_TYPES:
        return "security"
    return "user"

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
    dedupe_key: str | None = None,
) -> AgentRunEvent | None:
    """Append one ordered event and (idempotently) enqueue its webhook delivery.

    When ``dedupe_key`` is given the insert is idempotent: a second write of the
    same logical sub-event (terminal-artifact twin / reconnect replay) is a
    no-op and returns ``None`` WITHOUT re-enqueuing a webhook. Lifecycle events
    pass ``dedupe_key=None`` (emitted exactly once by the worker).

    The webhook outbox row is written in the SAME transaction (transactional
    outbox) for EVERY visibility the owner subscribed to; the browser SSE
    channel stays ``user``-only at the API read layer, independent of this.
    """
    if dedupe_key is not None:
        event = _insert_idempotent(
            session,
            run,
            event_type=event_type,
            payload=payload,
            visibility=visibility,
            dedupe_key=dedupe_key,
        )
        if event is None:
            # Already persisted (streamed earlier / replayed): skip the webhook
            # too so a coalesced delivery is never duplicated.
            return None
    else:
        event = AgentRunEvent(
            id=str(uuid.uuid4()),
            run_id=run.id,
            owner_subject=run.owner_subject,
            sequence=next_sequence(session, run.id),
            type=event_type,
            payload=payload,
            visibility=visibility,
            dedupe_key=None,
            created_at=_now(),
        )
        session.add(event)
    # Flush so the outbox row's FK references a persisted event id, then fan out
    # to the owner's webhook (scope-gated inside enqueue_webhook_if_configured).
    session.flush()
    enqueue_webhook_if_configured(session, run, event)
    return event


def _insert_idempotent(
    session: Session,
    run: AgentRun,
    *,
    event_type: str,
    payload: dict[str, Any],
    visibility: Visibility,
    dedupe_key: str,
) -> AgentRunEvent | None:
    """Insert an agent sub-event, skipping silently on a ``dedupe_key`` conflict.

    Returns the persisted row, or ``None`` when an equal-keyed row already
    exists (the unique partial index makes this race-safe across retries).
    """
    event_id = str(uuid.uuid4())
    stmt = (
        pg_insert(AgentRunEvent)
        .values(
            id=event_id,
            run_id=run.id,
            owner_subject=run.owner_subject,
            sequence=next_sequence(session, run.id),
            type=event_type,
            payload=payload,
            visibility=visibility,
            dedupe_key=dedupe_key,
            created_at=_now(),
        )
        .on_conflict_do_nothing(
            index_elements=["dedupe_key"],
            index_where=text("dedupe_key IS NOT NULL"),
        )
        .returning(AgentRunEvent.id)
    )
    inserted = session.execute(stmt).scalar_one_or_none()
    if inserted is None:
        return None
    return session.get(AgentRunEvent, event_id)


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
    """Write a webhook outbox row for ``event`` IF the owner subscribed to it.

    Called in the SAME transaction as the event it describes (transactional
    outbox): a separate dispatcher claims, coalesces, and sends pending rows.
    The unique ``(event_id, destination_url)`` index makes re-enqueue idempotent.

    The full firehose is the default: a delivery is written for EVERY visibility
    unless the owner narrowed it via ``visibility_scope`` / ``event_type_allowlist``
    (opt-out, never silent-drop). This does NOT widen the browser SSE channel,
    which the API filters to ``visibility = 'user'`` independently.
    """
    config = session.execute(
        select(WebhookAuthConfig).where(
            WebhookAuthConfig.owner_subject == run.owner_subject,
            WebhookAuthConfig.active.is_(True),
        )
    ).scalar_one_or_none()
    if config is None:
        return None

    scope = config.visibility_scope or list(DEFAULT_VISIBILITY_SCOPE)
    if event.visibility not in scope:
        return None
    allowlist = config.event_type_allowlist
    if allowlist is not None and event.type not in allowlist:
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
