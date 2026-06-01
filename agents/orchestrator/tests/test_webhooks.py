"""Webhook signing + backoff are deterministic and fail closed on exhaustion."""

from __future__ import annotations

import base64
import hashlib
import hmac

from nova_orchestrator.models import WebhookDelivery
from nova_orchestrator.webhooks import (
    BACKOFF_SCHEDULE_S,
    _mark_dead_letter,
    _schedule_retry_or_dead_letter,
    backoff_seconds,
    sign_body,
)

SECRET = "test-secret"


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
