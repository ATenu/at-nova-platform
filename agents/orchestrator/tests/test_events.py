"""Outbox event writer: I/O redaction + per-update webhook fan-out.

`safe_io` makes full tool/agent call inputs and outputs trackable without
leaking credentials or growing the row unbounded, and `emit_event` mirrors every
``user``-visibility update to the owner's webhook (not just ``run.completed``).
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_orchestrator import events as events_module
from nova_orchestrator.events import (
    _MAX_STRING,
    agent_event_visibility,
    emit_event,
    enqueue_webhook_if_configured,
    safe_io,
)
from nova_orchestrator.models import AgentRun, WebhookAuthConfig, WebhookDelivery


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


class _ConfigSession(_FakeSession):
    """Session whose execute() returns a single webhook config (or none)."""

    def __init__(self, config: WebhookAuthConfig | None) -> None:
        super().__init__()
        self._config = config

    def execute(self, _stmt: Any) -> Any:
        config = self._config

        class _Result:
            def scalar_one_or_none(self) -> Any:
                return config

        return _Result()


def _run() -> AgentRun:
    return AgentRun(id="11111111-1111-1111-1111-111111111111", owner_subject="user-1")


def _config(**overrides: Any) -> WebhookAuthConfig:
    config = WebhookAuthConfig(
        id="cfg-1",
        owner_subject="user-1",
        auth_type="hmac",
        destination_url="https://hook.example/ingest",
        active=True,
        visibility_scope=["user", "internal", "security"],
        event_type_allowlist=None,
        include_raw_payloads=False,
    )
    for key, value in overrides.items():
        setattr(config, key, value)
    return config


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


# -- visibility classification --------------------------------------------


def test_agent_event_visibility_classifier() -> None:
    # Node markers are operational telemetry (internal); the agent's own RBAC
    # decision projections are security; everything else is user-visible.
    assert agent_event_visibility("agent.node.started") == "internal"
    assert agent_event_visibility("agent.node.completed") == "internal"
    assert agent_event_visibility("agent.authz.allowed") == "security"
    assert agent_event_visibility("agent.authz.denied") == "security"
    assert agent_event_visibility("agent.query.started") == "user"
    assert agent_event_visibility("agent.write.completed") == "user"
    assert agent_event_visibility("agent.read.completed") == "user"


# -- emit_event webhook fan-out (full firehose) ----------------------------


def test_emit_event_enqueues_webhook_for_every_visibility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The firehose default: the webhook outbox is attempted for user, internal,
    # AND security. The browser SSE channel stays user-only at the API layer,
    # independent of this fan-out.
    enqueued: list[Any] = []
    monkeypatch.setattr(events_module, "next_sequence", lambda _s, _r: 1)
    monkeypatch.setattr(
        events_module,
        "enqueue_webhook_if_configured",
        lambda _s, _run, event: enqueued.append(event.visibility),
    )
    session = _FakeSession()
    for visibility, event_type in (
        ("user", "tool.call.completed"),
        ("internal", "planner.completed"),
        ("security", "authz.allowed"),
    ):
        emit_event(
            session,  # type: ignore[arg-type]
            _run(),
            event_type=event_type,
            payload={},
            visibility=visibility,
        )
    assert enqueued == ["user", "internal", "security"]


# -- enqueue_webhook_if_configured scope gating ----------------------------


def _delivery_for(event_type: str, visibility: str, config: WebhookAuthConfig) -> Any:
    session = _ConfigSession(config)
    event = emit_module_event(session, event_type, visibility)
    return enqueue_webhook_if_configured(session, _run(), event)  # type: ignore[arg-type]


def emit_module_event(session: Any, event_type: str, visibility: str) -> Any:
    from nova_orchestrator.models import AgentRunEvent

    return AgentRunEvent(
        id="evt-1",
        run_id="11111111-1111-1111-1111-111111111111",
        owner_subject="user-1",
        sequence=1,
        type=event_type,
        payload={},
        visibility=visibility,
    )


def test_enqueue_skips_visibility_outside_scope() -> None:
    config = _config(visibility_scope=["user"])
    assert _delivery_for("authz.allowed", "security", config) is None
    assert _delivery_for("planner.completed", "internal", config) is None
    delivery = _delivery_for("tool.call.completed", "user", config)
    assert isinstance(delivery, WebhookDelivery)


def test_enqueue_respects_event_type_allowlist() -> None:
    config = _config(event_type_allowlist=["run.completed"])
    assert _delivery_for("tool.call.completed", "user", config) is None
    assert isinstance(_delivery_for("run.completed", "user", config), WebhookDelivery)


def test_enqueue_no_config_is_noop() -> None:
    assert _delivery_for("run.completed", "user", None) is None  # type: ignore[arg-type]
