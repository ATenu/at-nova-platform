"""Startup catalog discovery client (snapshot-free, fail-soft).

The client mints a ``nova-mcp-data`` service token and GETs the MCP server's
``/catalog`` route to build the Agent Card. Every failure path (token error,
unreachable server, non-200, malformed body) must return an empty catalog so the
card falls back to its static description and the agent never fails to start.
"""

from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("KEYCLOAK_ISSUER_URL", "http://kc/realms/nova")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

import at_sql_analyser.mcp.catalog_client as catalog_client  # noqa: E402
from at_sql_analyser.auth.tokens import ServiceTokenError  # noqa: E402
from at_sql_analyser.mcp.catalog_client import fetch_catalog  # noqa: E402


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
    def __init__(self, status_code: int, body: Any = None, *, raises: bool = False) -> None:
        self.status_code = status_code
        self._body = body
        self._raises = raises

    def json(self) -> Any:
        if self._raises:
            raise ValueError("bad json")
        return self._body


def _patch_get(monkeypatch, response: _FakeResponse) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_get(url: str, *, headers: Any = None, timeout: Any = None) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        return response

    monkeypatch.setattr(catalog_client.httpx, "get", fake_get)
    return captured


def test_returns_views_with_auth_header(monkeypatch) -> None:
    views = [{"name": "sales"}, {"name": "customers"}]
    captured = _patch_get(monkeypatch, _FakeResponse(200, {"views": views}))
    tokens = _FakeTokens(token="tok-123")

    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=tokens, audience_scope="nova-mcp-data"
    )

    assert result == views
    assert tokens.scopes == ["nova-mcp-data"]
    assert captured["url"] == "http://db-mcp-server:8002/catalog"
    assert captured["headers"]["Authorization"] == "Bearer tok-123"


def test_filters_non_dict_views(monkeypatch) -> None:
    _patch_get(monkeypatch, _FakeResponse(200, {"views": [{"name": "sales"}, "nope", 5]}))
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=_FakeTokens(), audience_scope="nova-mcp-data"
    )
    assert result == [{"name": "sales"}]


def test_empty_on_non_200(monkeypatch) -> None:
    _patch_get(monkeypatch, _FakeResponse(403, {"views": [{"name": "sales"}]}))
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=_FakeTokens(), audience_scope="nova-mcp-data"
    )
    assert result == []


def test_empty_on_malformed_body(monkeypatch) -> None:
    _patch_get(monkeypatch, _FakeResponse(200, raises=True))
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=_FakeTokens(), audience_scope="nova-mcp-data"
    )
    assert result == []


def test_empty_on_views_not_list(monkeypatch) -> None:
    _patch_get(monkeypatch, _FakeResponse(200, {"views": {"name": "sales"}}))
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=_FakeTokens(), audience_scope="nova-mcp-data"
    )
    assert result == []


def test_empty_and_no_http_when_token_fails(monkeypatch) -> None:
    captured = _patch_get(monkeypatch, _FakeResponse(200, {"views": [{"name": "x"}]}))
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002",
        tokens=_FakeTokens(error=True),
        audience_scope="nova-mcp-data",
    )
    assert result == []
    assert captured == {}  # no HTTP attempted when the token cannot be minted


def test_empty_on_transport_error(monkeypatch) -> None:
    def boom(url: str, *, headers: Any = None, timeout: Any = None) -> _FakeResponse:
        raise catalog_client.httpx.ConnectError("down")

    monkeypatch.setattr(catalog_client.httpx, "get", boom)
    result = fetch_catalog(
        base_url="http://db-mcp-server:8002", tokens=_FakeTokens(), audience_scope="nova-mcp-data"
    )
    assert result == []
