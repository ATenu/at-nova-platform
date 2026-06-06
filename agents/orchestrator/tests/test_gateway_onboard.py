"""Admin onboarding endpoint: authn/authz, SSRF, native card success-gating.

Admin onboarding runs the *same* native A2A card path as self-registration, but
is driven only by the control plane (``nova-api``). It must fail closed: no token
-> 401, wrong azp -> 403, SSRF-unsafe host -> 400, card fetch failure -> 502,
empty-skills card -> 400, and a name already owned by a self-registered agent ->
409. The happy path upserts an ``admin``/``onboarded`` row through a faked session
so the test needs no Postgres or live agent. The card fetch is monkeypatched.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient

import nova_orchestrator.gateway as gateway

from .test_agents import _config

_AUTH = {"Authorization": "Bearer token"}
_VALID_CARD = {
    "name": "at-usecase-x",
    "version": "1.4.0",
    "skills": [{"id": "data.analyse.read", "name": "Analyse", "description": "d"}],
}


class _SelectResult:
    def __init__(self, existing: Any) -> None:
        self._existing = existing

    def scalar_one_or_none(self) -> Any:
        return self._existing


class _FakeSession:
    """Returns ``existing`` for the conflict SELECT; records the upsert/commit."""

    def __init__(self, existing: Any = None) -> None:
        self.existing = existing
        self.executed: list[Any] = []
        self.committed = False

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def execute(self, statement: Any) -> Any:
        self.executed.append(statement)
        # First call is the conflict SELECT; later calls are the upsert.
        return _SelectResult(self.existing)

    def commit(self) -> None:
        self.committed = True


def _client(
    monkeypatch,
    *,
    azp: str = "nova-api",
    existing: Any = None,
    card: dict[str, Any] | None = None,
    raise_card: bool = False,
) -> tuple[TestClient, _FakeSession]:
    config = _config()
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

    async def _resolve(_host: str, **_kwargs: Any) -> dict[str, Any]:
        if raise_card:
            raise gateway.CardFetchError("boom")
        return card if card is not None else _VALID_CARD

    monkeypatch.setattr(gateway, "resolve_agent_card", _resolve)

    session = _FakeSession(existing=existing)
    monkeypatch.setattr(gateway, "get_session_factory", lambda cfg=None: (lambda: session))
    return TestClient(app), session


def _body(**overrides: Any) -> dict[str, Any]:
    base = {"hostUrl": "http://at-usecase-x:8443", "audience": "nova-agent-usecase-x"}
    base.update(overrides)
    return base


def test_onboard_requires_bearer_token(monkeypatch) -> None:
    client, _ = _client(monkeypatch)
    assert client.post("/internal/agents/onboard", json=_body()).status_code == 401


def test_onboard_rejects_unauthorized_party(monkeypatch) -> None:
    client, _ = _client(monkeypatch, azp="nova-agent-sql-analyst")
    response = client.post("/internal/agents/onboard", headers=_AUTH, json=_body())
    assert response.status_code == 403


def test_onboard_rejects_unsafe_base_url(monkeypatch) -> None:
    client, _ = _client(monkeypatch)
    response = client.post(
        "/internal/agents/onboard",
        headers=_AUTH,
        json=_body(hostUrl="ftp://at-usecase-x/internal"),
    )
    assert response.status_code == 400


def test_onboard_returns_502_when_card_fetch_fails(monkeypatch) -> None:
    client, _ = _client(monkeypatch, raise_card=True)
    response = client.post("/internal/agents/onboard", headers=_AUTH, json=_body())
    assert response.status_code == 502


def test_onboard_rejects_card_without_skills(monkeypatch) -> None:
    client, _ = _client(monkeypatch, card={"name": "x", "skills": []})
    response = client.post("/internal/agents/onboard", headers=_AUTH, json=_body())
    assert response.status_code == 400


def test_onboard_conflicts_with_self_registered_name(monkeypatch) -> None:
    existing = SimpleNamespace(name="at-usecase-x", source="self")
    client, _ = _client(monkeypatch, existing=existing)
    response = client.post("/internal/agents/onboard", headers=_AUTH, json=_body())
    assert response.status_code == 409


def test_onboard_success_upserts_admin_row(monkeypatch) -> None:
    client, session = _client(monkeypatch)
    response = client.post(
        "/internal/agents/onboard",
        headers=_AUTH,
        json=_body(displayName="Use-case X", tags=["finance"], onboardedBy="kc-admin"),
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "at-usecase-x"
    assert payload["status"] == "onboarded"
    assert payload["skillIds"] == ["data.analyse.read"]
    assert payload["version"] == "1.4.0"
    assert session.committed is True
    # One SELECT (conflict check) + one upsert.
    assert len(session.executed) == 2


def test_onboard_uses_body_name_over_card_name(monkeypatch) -> None:
    client, _ = _client(monkeypatch)
    response = client.post(
        "/internal/agents/onboard",
        headers=_AUTH,
        json=_body(name="custom-name"),
    )
    assert response.status_code == 201
    assert response.json()["name"] == "custom-name"
