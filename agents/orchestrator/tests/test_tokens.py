"""Service-token minting: audience caching + scope-forwarding policy.

The dev realm injects per-hop audiences via protocol mappers on the worker
client, so forwarding the audience as an OAuth scope makes Keycloak respond
``invalid_scope``. These tests pin both modes.
"""

from __future__ import annotations

from typing import Any

import nova_orchestrator.tokens as tokens_module
from nova_orchestrator.tokens import ServiceTokenClient


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


def _capture(monkeypatch: Any) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def fake_post(url: str, *, data: dict[str, Any], **_: Any) -> _FakeResponse:
        calls.append(data)
        return _FakeResponse(200, {"access_token": "tok", "expires_in": 300})

    monkeypatch.setattr(tokens_module.httpx, "post", fake_post)
    return calls


def test_mapper_mode_does_not_forward_audience_as_scope(monkeypatch: Any) -> None:
    calls = _capture(monkeypatch)
    client = ServiceTokenClient(
        token_url="http://kc/token",
        client_id="nova-celery-worker",
        client_secret="secret",
        request_audience_scopes=False,
    )
    assert client.get_token("nova-agent-sql-analyst") == "tok"
    assert "scope" not in calls[0]


def test_client_scope_mode_forwards_audience_as_scope(monkeypatch: Any) -> None:
    calls = _capture(monkeypatch)
    client = ServiceTokenClient(
        token_url="http://kc/token",
        client_id="nova-celery-worker",
        client_secret="secret",
        request_audience_scopes=True,
    )
    client.get_token("nova-agent-sql-analyst")
    assert calls[0]["scope"] == "nova-agent-sql-analyst"


def test_token_cached_per_audience(monkeypatch: Any) -> None:
    calls = _capture(monkeypatch)
    client = ServiceTokenClient(
        token_url="http://kc/token",
        client_id="nova-celery-worker",
        client_secret="secret",
    )
    client.get_token("nova-agent-sql-analyst")
    client.get_token("nova-agent-sql-analyst")
    assert len(calls) == 1  # second call served from cache
    client.invalidate("nova-agent-sql-analyst")
    client.get_token("nova-agent-sql-analyst")
    assert len(calls) == 2
