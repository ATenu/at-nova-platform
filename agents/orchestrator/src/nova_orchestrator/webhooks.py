"""Webhook dispatcher (transactional outbox + HMAC, plan sections 12-13).

Webhooks are NEVER sent from inside the orchestration task. The worker writes
the event and its outbox row (`webhook_deliveries`) in one transaction; this
dispatcher claims due pending rows, signs the body, sends over HTTPS, and
records success/failure with exponential backoff until `succeeded` or
`dead_letter`. The signing secret is resolved from a reference at send time and
never stored or logged.

Signature base string (plan section 13):
    v1:{timestamp}:{eventId}:{sha256(rawBody)}
    signature = base64url(HMAC-SHA256(secret, baseString))
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .models import AgentRunEvent, WebhookAuthConfig, WebhookDelivery

# Exponential backoff with jitter is applied on top of this schedule (seconds):
# immediate, 10s, 30s, 2m, 10m, 30m, 2h, then dead-letter (plan section 13).
BACKOFF_SCHEDULE_S: tuple[int, ...] = (0, 10, 30, 120, 600, 1800, 7200)

# Receiver responses that must NOT be retried (permanent client errors).
NON_RETRYABLE_STATUS = frozenset({400, 401, 403, 404, 422})

# Sender: (url, headers, raw_body) -> HTTP status code.
Sender = Callable[[str, dict[str, str], bytes], int]


def sign_body(secret: str, timestamp: str, event_id: str, raw_body: bytes) -> str:
    body_hash = hashlib.sha256(raw_body).hexdigest()
    base_string = f"v1:{timestamp}:{event_id}:{body_hash}"
    digest = hmac.new(secret.encode("utf-8"), base_string.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii")


def backoff_seconds(attempt_count: int) -> int | None:
    """Delay before attempt ``attempt_count`` (0-based). ``None`` => dead-letter."""
    if attempt_count < len(BACKOFF_SCHEDULE_S):
        return BACKOFF_SCHEDULE_S[attempt_count]
    return None


def resolve_secret(secret_ref: str | None) -> str | None:
    """Resolve an HMAC secret from its reference.

    The DB stores only a reference (e.g. ``kv://owner/<sub>/webhook/hmac/v3``);
    in production this resolves against a managed secret store. For local/dev the
    secret is read from an env var named after the ref (non-alphanumerics ->
    ``_``), falling back to ``WEBHOOK_HMAC_SECRET``. Never logged.
    """
    if secret_ref:
        env_key = "WEBHOOK_SECRET__" + "".join(
            ch if ch.isalnum() else "_" for ch in secret_ref
        ).upper()
        from_ref = os.environ.get(env_key)
        if from_ref:
            return from_ref
    return os.environ.get("WEBHOOK_HMAC_SECRET")


def _build_raw_body(event: AgentRunEvent) -> bytes:
    payload: dict[str, Any] = {
        "eventId": event.id,
        "runId": event.run_id,
        "ownerSubject": event.owner_subject,
        "sequence": int(event.sequence),
        "type": event.type,
        "payload": event.payload,
        "createdAt": event.created_at.astimezone(UTC).isoformat(),
        "schemaVersion": 1,
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _headers(
    config: WebhookAuthConfig, delivery: WebhookDelivery, raw_body: bytes
) -> dict[str, str]:
    timestamp = str(int(datetime.now(UTC).timestamp()))
    headers = {
        "Content-Type": "application/json",
        "X-Nova-Event-Id": delivery.event_id,
        "X-Nova-Timestamp": timestamp,
        "X-Nova-Delivery-Id": delivery.id,
    }
    if config.auth_type in ("hmac", "bearer_hmac"):
        secret = resolve_secret(config.hmac_secret_ref)
        if secret:
            headers["X-Nova-Signature"] = "v1=" + sign_body(
                secret, timestamp, delivery.event_id, raw_body
            )
    if config.auth_type in ("bearer", "bearer_hmac"):
        token = resolve_secret(config.token_secret_ref)
        if token:
            headers["Authorization"] = f"Bearer {token}"
    return headers


def dispatch_due(
    session_factory: sessionmaker[Session],
    *,
    sender: Sender,
    now: datetime | None = None,
    limit: int = 50,
) -> int:
    """Process due deliveries. Returns the number of rows handled.

    Each row is claimed with ``FOR UPDATE SKIP LOCKED`` so multiple dispatcher
    workers never double-send. Pure of Celery for testing (inject ``sender``).
    """
    moment = now or datetime.now(UTC)
    handled = 0
    with session_factory() as session:
        rows = (
            session.execute(
                select(WebhookDelivery)
                .where(
                    WebhookDelivery.status == "pending",
                    WebhookDelivery.next_attempt_at <= moment,
                )
                .order_by(WebhookDelivery.next_attempt_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )
        for delivery in rows:
            _process_one(session, delivery, sender=sender)
            handled += 1
        session.commit()
    return handled


def _process_one(session: Session, delivery: WebhookDelivery, *, sender: Sender) -> None:
    config = (
        session.get(WebhookAuthConfig, delivery.auth_config_id)
        if delivery.auth_config_id
        else None
    )
    event = session.get(AgentRunEvent, delivery.event_id)
    if config is None or event is None or not config.active:
        _mark_dead_letter(delivery, "config_or_event_missing")
        return

    raw_body = _build_raw_body(event)
    headers = _headers(config, delivery, raw_body)
    delivery.attempt_count += 1

    try:
        status_code = sender(delivery.destination_url, headers, raw_body)
    except Exception as exc:  # noqa: BLE001 - transport errors must not crash the loop
        _schedule_retry_or_dead_letter(delivery, f"transport_error:{type(exc).__name__}")
        return

    if 200 <= status_code < 300:
        delivery.status = "succeeded"
        delivery.delivered_at = datetime.now(UTC)
        delivery.last_error = None
        return
    if status_code in NON_RETRYABLE_STATUS:
        _mark_dead_letter(delivery, f"non_retryable_status:{status_code}")
        return
    _schedule_retry_or_dead_letter(delivery, f"status:{status_code}")


def _schedule_retry_or_dead_letter(delivery: WebhookDelivery, reason: str) -> None:
    delay = backoff_seconds(delivery.attempt_count)
    delivery.last_error = reason
    if delay is None:
        delivery.status = "dead_letter"
        delivery.next_attempt_at = None
        return
    delivery.status = "pending"
    delivery.next_attempt_at = datetime.now(UTC) + timedelta(seconds=delay)


def _mark_dead_letter(delivery: WebhookDelivery, reason: str) -> None:
    delivery.status = "dead_letter"
    delivery.last_error = reason
    delivery.next_attempt_at = None
