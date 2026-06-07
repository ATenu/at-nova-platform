"""Native A2A self-registration client (startup + heartbeat + deregister).

Registration is best-effort and fail-soft: a token error or an unreachable /
rejecting orchestrator returns False and never raises (so it cannot block the
agent from serving tasks). The happy path posts the card with the audience-
restricted bearer token to the orchestrator's registration endpoint.
"""

from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("KEYCLOAK_ISSUER_URL", "http://kc/realms/nova")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

import at_sql_analyser.registration as registration  # noqa: E402
from at_sql_analyser.auth.tokens import ServiceTokenError  # noqa: E402
from at_sql_analyser.registration import AgentRegistrar  # noqa: E402


class _FakeTokens:
    def __init__(self, *, token: str | None = None, error: bool = False) -> None:
        self._token = token if token is not None else "tok"
        self._error = error
        self.scopes: list[str | None] = []

    def get_token(self, scope: str | None = None) -> str:
        self.scopes.append(scope)
        if self._error:
            raise ServiceTokenError("boom")
        return self._token


class _FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class _FakeAsyncClient:
    calls: list[dict[str, Any]] = []
    status: int = 200

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_args: object) -> bool:
        return False

    async def post(self, url: str, *, json: Any = None, headers: Any = None) -> _FakeResponse:
        _FakeAsyncClient.calls.append(
            {"method": "POST", "url": url, "json": json, "headers": headers}
        )
        return _FakeResponse(_FakeAsyncClient.status)

    async def delete(self, url: str, *, headers: Any = None) -> _FakeResponse:
        _FakeAsyncClient.calls.append({"method": "DELETE", "url": url, "headers": headers})
        return _FakeResponse(_FakeAsyncClient.status)


_DEFAULT_CARD = {"skills": [{"id": "data.analyse.read"}]}


def _registrar(
    tokens: _FakeTokens,
    *,
    card_provider: Any | None = None,
) -> AgentRegistrar:
    return AgentRegistrar(
        orchestrator_url="http://orchestrator:8001",
        audience_scope="nova-orchestrator",
        tokens=tokens,  # type: ignore[arg-type]
        name="at-sql-analyser",
        base_url="http://at-sql-analyser:8003",
        audience="nova-agent-sql-analyst",
        card_provider=card_provider or (lambda: dict(_DEFAULT_CARD)),
        heartbeat_s=3600,
    )


def _reset_client(monkeypatch, *, status: int = 200) -> None:
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.status = status
    monkeypatch.setattr(registration.httpx, "AsyncClient", _FakeAsyncClient)


async def test_register_once_posts_card_with_bearer(monkeypatch) -> None:
    _reset_client(monkeypatch)
    tokens = _FakeTokens(token="tok-123")
    ok = await _registrar(tokens).register_once()

    assert ok is True
    assert tokens.scopes == ["nova-orchestrator"]
    assert len(_FakeAsyncClient.calls) == 1
    call = _FakeAsyncClient.calls[0]
    assert call["url"] == "http://orchestrator:8001/internal/agents/register"
    assert call["headers"] == {"Authorization": "Bearer tok-123"}
    assert call["json"]["name"] == "at-sql-analyser"
    assert call["json"]["baseUrl"] == "http://at-sql-analyser:8003"
    assert call["json"]["audience"] == "nova-agent-sql-analyst"
    assert call["json"]["card"] == {"skills": [{"id": "data.analyse.read"}]}


async def test_register_once_rebuilds_card_each_call(monkeypatch) -> None:
    # The provider is invoked per heartbeat so a changed data surface propagates
    # without a restart (no frozen startup snapshot).
    _reset_client(monkeypatch)
    cards = [
        {"skills": [{"id": "data.analyse.read", "name": "v1"}]},
        {"skills": [{"id": "data.analyse.read", "name": "v2"}]},
    ]
    calls = {"n": 0}

    def provider() -> dict[str, Any]:
        card = cards[min(calls["n"], len(cards) - 1)]
        calls["n"] += 1
        return card

    registrar = _registrar(_FakeTokens(), card_provider=provider)
    await registrar.register_once()
    await registrar.register_once()

    assert calls["n"] == 2
    assert _FakeAsyncClient.calls[0]["json"]["card"] == cards[0]
    assert _FakeAsyncClient.calls[1]["json"]["card"] == cards[1]


async def test_register_once_fails_soft_when_card_rebuild_raises(monkeypatch) -> None:
    # A provider failure skips the heartbeat instead of crashing the loop.
    _reset_client(monkeypatch)

    def boom() -> dict[str, Any]:
        raise RuntimeError("catalog blew up")

    ok = await _registrar(_FakeTokens(), card_provider=boom).register_once()
    assert ok is False
    assert _FakeAsyncClient.calls == []


async def test_register_once_returns_false_on_rejection(monkeypatch) -> None:
    _reset_client(monkeypatch, status=403)
    ok = await _registrar(_FakeTokens()).register_once()
    assert ok is False


async def test_register_once_fails_soft_without_token(monkeypatch) -> None:
    _reset_client(monkeypatch)
    ok = await _registrar(_FakeTokens(error=True)).register_once()
    assert ok is False
    # No HTTP attempted when the token cannot be minted.
    assert _FakeAsyncClient.calls == []


async def test_start_registers_then_stop_deregisters(monkeypatch) -> None:
    _reset_client(monkeypatch)
    registrar = _registrar(_FakeTokens())
    await registrar.start()
    await registrar.stop()

    methods = [call["method"] for call in _FakeAsyncClient.calls]
    assert methods[0] == "POST"
    assert "DELETE" in methods
    delete_call = next(c for c in _FakeAsyncClient.calls if c["method"] == "DELETE")
    assert delete_call["url"] == "http://orchestrator:8001/internal/agents/at-sql-analyser"
