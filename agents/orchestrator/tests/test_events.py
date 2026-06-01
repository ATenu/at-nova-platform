"""Outbox event writer: I/O redaction + per-update webhook fan-out.

`safe_io` makes full tool/agent call inputs and outputs trackable without
leaking credentials or growing the row unbounded, and `emit_event` mirrors every
``user``-visibility update to the owner's webhook (not just ``run.completed``).
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_orchestrator import events as events_module
from nova_orchestrator.events import _MAX_STRING, emit_event, safe_io
from nova_orchestrator.models import AgentRun


class _FakeSession:
    """Minimal session: emit_event only needs add() + flush() once sequence and
    webhook enqueue are stubbed."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.flushed = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushed += 1


def _run() -> AgentRun:
    return AgentRun(id="11111111-1111-1111-1111-111111111111", owner_subject="user-1")


# -- safe_io ---------------------------------------------------------------


def test_safe_io_redacts_secret_like_keys_but_keeps_business_data() -> None:
    out = safe_io(
        {
            "customerId": "c-1",
            "apiKey": "sk-secret",
            "nested": {"access_token": "t", "fullName": "Ada Lovelace"},
            "items": [{"productId": "p-1", "password": "hunter2"}],
        }
    )
    assert out["customerId"] == "c-1"
    assert out["apiKey"] == "[redacted]"
    assert out["nested"]["access_token"] == "[redacted]"
    # Business data (incl. the owner's own PII) is preserved for the owner's stream.
    assert out["nested"]["fullName"] == "Ada Lovelace"
    assert out["items"][0]["productId"] == "p-1"
    assert out["items"][0]["password"] == "[redacted]"


def test_safe_io_bounds_long_strings() -> None:
    out = safe_io({"blob": "x" * (_MAX_STRING + 5000)})
    assert isinstance(out["blob"], str)
    assert len(out["blob"]) <= _MAX_STRING + 1  # truncated + ellipsis


def test_safe_io_bounds_depth_without_raising() -> None:
    deep: dict[str, Any] = {}
    current = deep
    for _ in range(50):
        child: dict[str, Any] = {}
        current["child"] = child
        current = child
    # Must terminate (no unbounded recursion) and stay JSON-serializable.
    assert safe_io(deep) is not None


def test_safe_io_passes_through_scalars() -> None:
    assert safe_io(12) == 12
    assert safe_io(True) is True
    assert safe_io(None) is None
    assert safe_io(1.5) == 1.5


# -- emit_event webhook fan-out -------------------------------------------


def test_user_event_enqueues_a_webhook(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueued: list[Any] = []
    monkeypatch.setattr(events_module, "next_sequence", lambda _s, _r: 1)
    monkeypatch.setattr(
        events_module,
        "enqueue_webhook_if_configured",
        lambda _s, _run, event: enqueued.append(event),
    )
    session = _FakeSession()
    event = emit_event(
        session,  # type: ignore[arg-type]
        _run(),
        event_type="tool.call.completed",
        payload={"capability": "sales.create", "output": {"id": "s-1"}},
        visibility="user",
    )
    assert enqueued == [event]
    assert session.flushed == 1


def test_internal_and_security_events_never_webhook(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueued: list[Any] = []
    monkeypatch.setattr(events_module, "next_sequence", lambda _s, _r: 1)
    monkeypatch.setattr(
        events_module,
        "enqueue_webhook_if_configured",
        lambda _s, _run, event: enqueued.append(event),
    )
    session = _FakeSession()
    emit_event(
        session,  # type: ignore[arg-type]
        _run(),
        event_type="planner.completed",
        payload={},
        visibility="internal",
    )
    emit_event(
        session,  # type: ignore[arg-type]
        _run(),
        event_type="authz.denied",
        payload={"reason": "missing_permission"},
        visibility="security",
    )
    assert enqueued == []
    assert session.flushed == 0
