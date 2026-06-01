"""Webhook signing + backoff are deterministic and fail closed on exhaustion."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime

from nova_orchestrator.models import AgentRunEvent, WebhookAuthConfig, WebhookDelivery
from nova_orchestrator.webhooks import (
    BACKOFF_SCHEDULE_S,
    _mark_dead_letter,
    _schedule_retry_or_dead_letter,
    _send_chunk,
    backoff_seconds,
    build_batch_body,
    sign_body,
)

SECRET = "test-secret"


def _event(run_id: str, sequence: int, event_type: str = "tool.call.completed") -> AgentRunEvent:
    event = AgentRunEvent()
    event.id = f"evt-{run_id}-{sequence}"
    event.run_id = run_id
    event.owner_subject = "user-1"
    event.sequence = sequence
    event.type = event_type
    event.payload = {"n": sequence}
    event.created_at = datetime(2026, 6, 1, 9, 0, sequence, tzinfo=UTC)
    return event


def _config(auth_type: str = "none") -> WebhookAuthConfig:
    config = WebhookAuthConfig()
    config.id = "cfg-1"
    config.owner_subject = "user-1"
    config.auth_type = auth_type
    config.destination_url = "https://hook.example/ingest"
    config.active = True
    return config


def _delivery(event: AgentRunEvent) -> WebhookDelivery:
    delivery = WebhookDelivery()
    delivery.id = f"del-{event.id}"
    delivery.event_id = event.id
    delivery.destination_url = "https://hook.example/ingest"
    delivery.auth_config_id = "cfg-1"
    delivery.status = "pending"
    delivery.attempt_count = 0
    return delivery


def test_sign_body_matches_v1_base_string() -> None:
    raw = b'{"a":1}'
    timestamp = "1717400000"
    event_id = "evt-1"
    expected_base = f"v1:{timestamp}:{event_id}:{hashlib.sha256(raw).hexdigest()}"
    expected = base64.urlsafe_b64encode(
        hmac.new(SECRET.encode(), expected_base.encode(), hashlib.sha256).digest()
    ).decode()
    assert sign_body(SECRET, timestamp, event_id, raw) == expected


def test_sign_body_changes_with_body() -> None:
    a = sign_body(SECRET, "1", "e", b"one")
    b = sign_body(SECRET, "1", "e", b"two")
    assert a != b


def test_backoff_follows_schedule_then_dead_letters() -> None:
    for attempt, expected in enumerate(BACKOFF_SCHEDULE_S):
        assert backoff_seconds(attempt) == expected
    assert backoff_seconds(len(BACKOFF_SCHEDULE_S)) is None


def test_retry_schedules_next_attempt_until_exhausted() -> None:
    delivery = WebhookDelivery()
    delivery.attempt_count = 1
    _schedule_retry_or_dead_letter(delivery, "status:500")
    assert delivery.status == "pending"
    assert delivery.next_attempt_at is not None

    delivery.attempt_count = len(BACKOFF_SCHEDULE_S)
    _schedule_retry_or_dead_letter(delivery, "status:500")
    assert delivery.status == "dead_letter"
    assert delivery.next_attempt_at is None


def test_mark_dead_letter() -> None:
    delivery = WebhookDelivery()
    _mark_dead_letter(delivery, "config_missing")
    assert delivery.status == "dead_letter"
    assert delivery.last_error == "config_missing"


# -- coalescing / batch body ------------------------------------------------


def test_build_batch_body_orders_by_run_then_sequence() -> None:
    body = build_batch_body(
        "batch-1",
        [_event("run-b", 2), _event("run-a", 5), _event("run-a", 1)],
    )
    parsed = json.loads(body)
    assert parsed["schemaVersion"] == 2
    assert parsed["batchId"] == "batch-1"
    assert parsed["count"] == 3
    order = [(e["runId"], e["sequence"]) for e in parsed["events"]]
    assert order == [("run-a", 1), ("run-a", 5), ("run-b", 2)]


def test_send_chunk_marks_whole_batch_succeeded_on_2xx() -> None:
    sent: list[tuple[str, bytes]] = []

    def sender(url: str, _headers: dict[str, str], body: bytes) -> int:
        sent.append((url, body))
        return 202

    chunk = [(_delivery(e), e) for e in (_event("run-a", 1), _event("run-a", 2))]
    _send_chunk(_config(), chunk, sender=sender)
    assert len(sent) == 1  # one coalesced POST for the whole chunk
    assert all(d.status == "succeeded" for d, _ in chunk)
    assert all(d.attempt_count == 1 for d, _ in chunk)


def test_send_chunk_dead_letters_on_non_retryable_status() -> None:
    chunk = [(_delivery(e), e) for e in (_event("run-a", 1),)]
    _send_chunk(_config(), chunk, sender=lambda *_: 422)
    assert chunk[0][0].status == "dead_letter"
    assert chunk[0][0].last_error == "non_retryable_status:422"


def test_send_chunk_retries_on_5xx() -> None:
    chunk = [(_delivery(e), e) for e in (_event("run-a", 1),)]
    _send_chunk(_config(), chunk, sender=lambda *_: 503)
    assert chunk[0][0].status == "pending"
    assert chunk[0][0].next_attempt_at is not None


def test_send_chunk_retries_on_transport_error() -> None:
    def sender(*_: object) -> int:
        raise ConnectionError("boom")

    chunk = [(_delivery(e), e) for e in (_event("run-a", 1),)]
    _send_chunk(_config(), chunk, sender=sender)
    assert chunk[0][0].status == "pending"
    assert chunk[0][0].last_error == "transport_error:ConnectionError"
