"""Native A2A self-registration endpoint: authn/authz + input validation.

The registration endpoint is internal and must fail closed: no token -> 401, a
token whose azp is not an allowlisted agent client -> 403, and SSRF-unsafe or
empty-skill payloads -> 400. The happy path upserts (heartbeat) through a faked
session so the test needs no Postgres. Token signature verification is stubbed
(covered elsewhere); these tests focus on the new gateway logic.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient

import nova_orchestrator.gateway as gateway

from .test_agents import _config

_VALID_CARD = {"skills": [{"id": "data.analyse.read", "name": "Analyse", "description": "d"}]}


class _FakeSession:
    def __init__(self) -> None:
        self.executed: list[Any] = []
        self.committed = False
        self.deleted: list[Any] = []
        self.store: dict[str, Any] = {}

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def execute(self, statement: Any) -> None:
        self.executed.append(statement)

    def commit(self) -> None:
        self.committed = True

    def get(self, _model: Any, key: str) -> Any:
        return self.store.get(key)

    def delete(self, row: Any) -> None:
        self.deleted.append(row)


def _client(monkeypatch, *, azp: str) -> tuple[TestClient, _FakeSession]:
    config = _config(agent_registration_authorized_parties=("nova-agent-sql-analyst",))
    app = gateway.create_app(config)

    monkeypatch.setattr(
        gateway.PyJWKClient,
        "get_signing_key_from_jwt",
        lambda self, token: SimpleNamespace(key="k"),
    )
    monkeypatch.setattr(
        gateway.jwt,
        "decode",
        lambda *args, **kwargs: {"azp": azp, "aud": "nova-orchestrator"},
    )
    session = _FakeSession()
    monkeypatch.setattr(gateway, "get_session_factory", lambda cfg=None: (lambda: session))
    return TestClient(app), session


_AUTH = {"Authorization": "Bearer token"}


def test_register_requires_bearer_token(monkeypatch) -> None:
    client, _ = _client(monkeypatch, azp="nova-agent-sql-analyst")
    response = client.post(
        "/internal/agents/register",
        json={
            "name": "at-sql-analyser",
            "baseUrl": "http://at-sql-analyser:8003",
            "audience": "nova-agent-sql-analyst",
            "card": _VALID_CARD,
        },
    )
    assert response.status_code == 401


def test_register_rejects_unauthorized_party(monkeypatch) -> None:
    client, _ = _client(monkeypatch, azp="some-other-client")
    response = client.post(
        "/internal/agents/register",
        headers=_AUTH,
        json={
            "name": "rogue",
            "baseUrl": "http://rogue:8003",
            "audience": "nova-agent-rogue",
            "card": _VALID_CARD,
        },
    )
    assert response.status_code == 403


def test_register_rejects_unsafe_base_url(monkeypatch) -> None:
    client, _ = _client(monkeypatch, azp="nova-agent-sql-analyst")
    response = client.post(
        "/internal/agents/register",
        headers=_AUTH,
        json={
            "name": "at-sql-analyser",
            "baseUrl": "ftp://at-sql-analyser/internal",
            "audience": "nova-agent-sql-analyst",
            "card": _VALID_CARD,
        },
    )
    assert response.status_code == 400


def test_register_rejects_card_without_skills(monkeypatch) -> None:
    client, _ = _client(monkeypatch, azp="nova-agent-sql-analyst")
    response = client.post(
        "/internal/agents/register",
        headers=_AUTH,
        json={
            "name": "at-sql-analyser",
            "baseUrl": "http://at-sql-analyser:8003",
            "audience": "nova-agent-sql-analyst",
            "card": {"skills": []},
        },
    )
    assert response.status_code == 400


def test_register_success_upserts(monkeypatch) -> None:
    client, session = _client(monkeypatch, azp="nova-agent-sql-analyst")
    response = client.post(
        "/internal/agents/register",
        headers=_AUTH,
        json={
            "name": "at-sql-analyser",
            "baseUrl": "http://at-sql-analyser:8003",
            "audience": "nova-agent-sql-analyst",
            "card": _VALID_CARD,
        },
    )
    assert response.status_code == 200
    assert response.json() == {"name": "at-sql-analyser", "status": "registered"}
    assert len(session.executed) == 1
    assert session.committed is True


def test_deregister_removes_existing_row(monkeypatch) -> None:
    client, session = _client(monkeypatch, azp="nova-agent-sql-analyst")
    row = object()
    session.store["at-sql-analyser"] = row
    response = client.delete("/internal/agents/at-sql-analyser", headers=_AUTH)
    assert response.status_code == 200
    assert response.json() == {"name": "at-sql-analyser", "status": "deregistered"}
    assert session.deleted == [row]
    assert session.committed is True
