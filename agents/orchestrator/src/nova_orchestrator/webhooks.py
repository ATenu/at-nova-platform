"""Webhook dispatcher (transactional outbox + HMAC, plan sections 12-13).

Webhooks are NEVER sent from inside the orchestration task. The worker writes
the event and its outbox row (`webhook_deliveries`) in one transaction; this
dispatcher claims due pending rows, **coalesces** all due deliveries for the
same destination into ONE signed HTTP POST (an ordered ``events[]`` batch),
sends over HTTPS, and records success/failure with exponential backoff until
`succeeded` or `dead_letter`. Coalescing is the primary volume control under the
full firehose (every node execution, tool/MCP call, and RBAC decision): it cuts
HTTP requests 10-50x WITHOUT dropping any event from the audit trail. The
signing secret is resolved from a reference at send time and never stored or
logged.

Signature base string (plan section 13):
    v1:{timestamp}:{batchId}:{sha256(rawBody)}
    signature = base64url(HMAC-SHA256(secret, baseString))

``batchId`` is the lead delivery id of the coalesced group; each event keeps its
own ``eventId``/``sequence`` inside the body so the receiver can order + dedupe.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from collections import defaultdict
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

# Cap the coalesced body so a burst of large events cannot produce an unbounded
# POST; a group that would exceed this is split into multiple ordered batches.
# safe_io already bounds each event, so this is a coarse second guard.
_MAX_BATCH_EVENTS = 100

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


def _event_body(event: AgentRunEvent) -> dict[str, Any]:
    return {
        "eventId": event.id,
        "runId": event.run_id,
        "ownerSubject": event.owner_subject,
        "sequence": int(event.sequence),
        "type": event.type,
        "payload": event.payload,
        "createdAt": event.created_at.astimezone(UTC).isoformat(),
    }


def build_batch_body(batch_id: str, events: list[AgentRunEvent]) -> bytes:
    """Serialize a coalesced, ordered batch of events into one signed body.

    The events are ordered by ``(run_id, sequence)`` so a receiver can reconcile
    each run's timeline; every element keeps its own ``eventId`` for dedupe.
    """
    ordered = sorted(events, key=lambda e: (e.run_id, int(e.sequence)))
    payload: dict[str, Any] = {
        "schemaVersion": 2,
        "batchId": batch_id,
        "count": len(ordered),
        "events": [_event_body(event) for event in ordered],
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _batch_headers(
    config: WebhookAuthConfig, batch_id: str, event_count: int, raw_body: bytes
) -> dict[str, str]:
    timestamp = str(int(datetime.now(UTC).timestamp()))
    headers = {
        "Content-Type": "application/json",
        "X-Nova-Batch-Id": batch_id,
        "X-Nova-Event-Count": str(event_count),
        "X-Nova-Timestamp": timestamp,
    }
    if config.auth_type in ("hmac", "bearer_hmac"):
        secret = resolve_secret(config.hmac_secret_ref)
        if secret:
            headers["X-Nova-Signature"] = "v1=" + sign_body(
                secret, timestamp, batch_id, raw_body
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
    limit: int = 200,
) -> int:
    """Process due deliveries. Returns the number of rows handled.

    Rows are claimed with ``FOR UPDATE SKIP LOCKED`` so multiple dispatcher
    workers never double-send, then **coalesced by destination** into batched
    POSTs. Pure of Celery for testing (inject ``sender``).
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
        # Coalesce by (destination, auth config): one signed POST per group, so
        # a long run's dozens of audit events collapse into a few HTTP requests.
        groups: dict[tuple[str, str | None], list[WebhookDelivery]] = defaultdict(list)
        for delivery in rows:
            groups[(delivery.destination_url, delivery.auth_config_id)].append(delivery)
        for group in groups.values():
            _process_group(session, group, sender=sender)
            handled += len(group)
        session.commit()
    return handled


def _process_group(
    session: Session, deliveries: list[WebhookDelivery], *, sender: Sender
) -> None:
    """Send one coalesced batch for a destination, splitting on the size cap."""
    lead = deliveries[0]
    config = (
        session.get(WebhookAuthConfig, lead.auth_config_id)
        if lead.auth_config_id
        else None
    )
    if config is None or not config.active:
        for delivery in deliveries:
            _mark_dead_letter(delivery, "config_missing")
        return

    # Resolve each delivery's event; a missing event is permanently dead-lettered
    # (its row was deleted) and excluded from the batch.
    pairs: list[tuple[WebhookDelivery, AgentRunEvent]] = []
    for delivery in deliveries:
        event = session.get(AgentRunEvent, delivery.event_id)
        if event is None:
            _mark_dead_letter(delivery, "event_missing")
            continue
        pairs.append((delivery, event))

    for start in range(0, len(pairs), _MAX_BATCH_EVENTS):
        chunk = pairs[start : start + _MAX_BATCH_EVENTS]
        if chunk:
            _send_chunk(config, chunk, sender=sender)


def _send_chunk(
    config: WebhookAuthConfig,
    chunk: list[tuple[WebhookDelivery, AgentRunEvent]],
    *,
    sender: Sender,
) -> None:
    batch_id = str(uuid.uuid4())
    events = [event for _delivery, event in chunk]
    raw_body = build_batch_body(batch_id, events)
    headers = _batch_headers(config, batch_id, len(events), raw_body)
    for delivery, _event in chunk:
        delivery.attempt_count += 1

    try:
        status_code = sender(config.destination_url, headers, raw_body)
    except Exception as exc:  # noqa: BLE001 - transport errors must not crash the loop
        for delivery, _event in chunk:
            _schedule_retry_or_dead_letter(delivery, f"transport_error:{type(exc).__name__}")
        return

    if 200 <= status_code < 300:
        delivered = datetime.now(UTC)
        for delivery, _event in chunk:
            delivery.status = "succeeded"
            delivery.delivered_at = delivered
            delivery.last_error = None
        return
    if status_code in NON_RETRYABLE_STATUS:
        for delivery, _event in chunk:
            _mark_dead_letter(delivery, f"non_retryable_status:{status_code}")
        return
    for delivery, _event in chunk:
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
