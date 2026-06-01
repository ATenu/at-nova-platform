"""Fail-soft tracing semantics for the Langfuse helpers.

These pin the contract that a regression broke in production: tracing wrappers
must degrade to a no-op when Langfuse is disabled or unhealthy, but they must
NOT swallow exceptions raised by the wrapped body. Swallowing a body exception
and re-yielding raised ``RuntimeError: generator didn't stop after throw()``,
which crashed the orchestration run on any tool/agent failure (e.g. a rejected
tool input) so the user never received a response.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_orchestrator.observability import langfuse_tracing as lt


class _FakeObservation:
    """Stand-in for a native Langfuse observation context manager."""

    def __init__(self) -> None:
        self.exits: list[tuple[Any, Any, Any]] = []

    def __enter__(self) -> _FakeObservation:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        self.exits.append((exc_type, exc, tb))
        return False  # never suppress the body's exception


class _FakeClient:
    def __init__(self) -> None:
        self.observation = _FakeObservation()
        self.trace_updates: list[dict[str, Any]] = []

    def start_as_current_observation(self, **_kwargs: Any) -> _FakeObservation:
        return self.observation

    def update_current_trace(self, **attrs: Any) -> None:
        self.trace_updates.append(attrs)


class _BrokenClient:
    """A client whose tracing setup always fails (Langfuse unhealthy)."""

    def start_as_current_observation(self, **_kwargs: Any) -> Any:
        raise RuntimeError("langfuse unreachable")

    def update_current_trace(self, **_attrs: Any) -> None:  # pragma: no cover
        raise RuntimeError("langfuse unreachable")


def _use_client(monkeypatch: pytest.MonkeyPatch, client: Any) -> None:
    monkeypatch.setattr(lt, "get_tracer", lambda: client)


def test_tool_span_propagates_body_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient()
    _use_client(monkeypatch, client)

    with pytest.raises(ValueError, match="boom"):
        with lt.tool_span("tool:issues.list", capability="issues.list"):
            raise ValueError("boom")

    # The span was closed WITH the original exception (recorded, not swallowed).
    assert client.observation.exits, "observation was never closed"
    exc_type, _exc, _tb = client.observation.exits[-1]
    assert exc_type is ValueError


def test_tool_span_completes_normally(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient()
    _use_client(monkeypatch, client)

    ran = False
    with lt.tool_span("tool:issues.list", capability="issues.list"):
        ran = True

    assert ran
    assert client.observation.exits[-1][0] is None


def test_tool_span_is_noop_when_tracing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_client(monkeypatch, None)

    # Body still runs and its exception still propagates with no client present.
    with pytest.raises(ValueError):
        with lt.tool_span("tool:x"):
            raise ValueError("boom")


def test_tool_span_setup_failure_is_soft(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_client(monkeypatch, _BrokenClient())

    # A tracing setup failure must not break the wrapped call: the body runs and
    # completes as if untraced.
    ran = False
    with lt.tool_span("tool:x"):
        ran = True
    assert ran


def test_tool_span_setup_failure_still_propagates_body_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_client(monkeypatch, _BrokenClient())

    with pytest.raises(ValueError):
        with lt.tool_span("tool:x"):
            raise ValueError("boom")


def test_run_trace_propagates_body_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient()
    _use_client(monkeypatch, client)
    monkeypatch.setattr(lt, "trace_id_for", lambda _run_id: "trace-123")

    with pytest.raises(ValueError, match="boom"):
        with lt.run_trace(run_id="11111111-1111-1111-1111-111111111111", name="orchestrator.run"):
            raise ValueError("boom")

    assert client.observation.exits[-1][0] is ValueError


def test_run_trace_records_trace_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient()
    _use_client(monkeypatch, client)
    monkeypatch.setattr(lt, "trace_id_for", lambda _run_id: "trace-123")

    with lt.run_trace(
        run_id="11111111-1111-1111-1111-111111111111",
        name="orchestrator.run",
        user_id="user-1",
        session_id="conv-1",
    ):
        pass

    assert client.trace_updates, "trace attributes were never recorded"
    attrs = client.trace_updates[-1]
    assert attrs["session_id"] == "conv-1"
    assert attrs["user_id"] == "user-1"


def test_run_trace_is_noop_when_tracing_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_client(monkeypatch, None)

    with lt.run_trace(run_id="11111111-1111-1111-1111-111111111111", name="orchestrator.run"):
        pass  # no client, no error
