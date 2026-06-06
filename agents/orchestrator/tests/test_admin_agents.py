"""Synthetic heartbeat for admin-onboarded agents: liveness without drift.

The poller keeps the "admin agents are durable" assumption honest. A healthy
re-fetch refreshes timestamps and clears errors; repeated failures escalate to
``unreachable`` only after the configured threshold; an unsafe host (allowlist
changed post-onboarding) fails closed; and a card that advertises no routable
skills is treated as a failure. The fake session selects only the rows the query
would, so the test needs no Postgres.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from nova_orchestrator.admin_agents import revalidate_admin_agents
from nova_orchestrator.models import A2aAgentRegistration

from .test_agents import _config

_GOOD_CARD = {
    "name": "at-usecase-x",
    "version": "2.0.0",
    "skills": [{"id": "data.analyse.read", "name": "Analyse", "description": "d"}],
}


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _FakeResult:
        return self

    def all(self) -> list[Any]:
        return self._rows


class _FakeSession:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows
        self.committed = False

    def execute(self, _statement: Any) -> _FakeResult:
        return _FakeResult(self._rows)

    def commit(self) -> None:
        self.committed = True


def _row(**overrides: Any) -> A2aAgentRegistration:
    row = A2aAgentRegistration()
    row.name = "at-usecase-x"
    row.base_url = "http://at-usecase-x:8443"
    row.audience = "nova-agent-usecase-x"
    row.card = {"skills": [{"id": "data.analyse.read"}]}
    row.skill_ids = ["data.analyse.read"]
    row.source = "admin"
    row.status = "onboarded"
    row.enabled = True
    row.consecutive_failures = 0
    row.last_error = None
    row.last_seen_at = datetime(2026, 1, 1, tzinfo=UTC)
    row.last_card_fetch_at = datetime(2026, 1, 1, tzinfo=UTC)
    row.version = "1.0.0"
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


def test_healthy_refresh_clears_error_and_updates_card() -> None:
    row = _row(consecutive_failures=2, last_error="unreachable", status="unreachable")
    session = _FakeSession([row])
    moment = datetime(2026, 6, 6, tzinfo=UTC)

    summary = revalidate_admin_agents(
        session, _config(), fetch_card=lambda _url: _GOOD_CARD, now=moment
    )

    assert summary == {"checked": 1, "healthy": 1, "unreachable": 0}
    assert row.status == "onboarded"
    assert row.consecutive_failures == 0
    assert row.last_error is None
    assert row.last_seen_at == moment
    assert row.version == "2.0.0"
    assert session.committed is True


def test_single_failure_increments_but_stays_onboarded() -> None:
    row = _row()
    session = _FakeSession([row])

    def _boom(_url: str) -> dict[str, Any]:
        raise RuntimeError("connect timeout")

    summary = revalidate_admin_agents(session, _config(), fetch_card=_boom)

    assert summary["checked"] == 1
    assert row.consecutive_failures == 1
    assert row.status == "onboarded"  # below threshold (3)
    assert row.last_error == "unreachable"


def test_failures_escalate_to_unreachable_at_threshold() -> None:
    row = _row(consecutive_failures=2)
    session = _FakeSession([row])

    def _boom(_url: str) -> dict[str, Any]:
        raise RuntimeError("connect timeout")

    summary = revalidate_admin_agents(session, _config(), fetch_card=_boom)

    assert row.consecutive_failures == 3
    assert row.status == "unreachable"
    assert summary["unreachable"] == 1


def test_unsafe_host_fails_closed_without_fetch() -> None:
    row = _row(base_url="http://at-usecase-x:8443", consecutive_failures=2)
    session = _FakeSession([row])
    calls: list[str] = []

    def _track(url: str) -> dict[str, Any]:
        calls.append(url)
        return _GOOD_CARD

    summary = revalidate_admin_agents(
        session,
        _config(agent_registration_allowed_hosts=("only-this-host",)),
        fetch_card=_track,
    )

    assert calls == []  # never reached out to a disallowed host
    assert row.status == "unreachable"
    assert row.last_error == "host no longer allowed"
    assert summary["unreachable"] == 1


def test_card_without_skills_is_a_failure() -> None:
    row = _row(consecutive_failures=2)
    session = _FakeSession([row])

    summary = revalidate_admin_agents(
        session, _config(), fetch_card=lambda _url: {"name": "x", "skills": []}
    )

    assert row.status == "unreachable"
    assert row.last_error == "no routable skills"
    assert summary["healthy"] == 0
