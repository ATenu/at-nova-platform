"""Per-hop OAuth2 client_credentials token minting for the agent's outbound calls.

The agent mints short-lived, audience-restricted service tokens (``nova-mcp-data``)
so a token minted for the data plane cannot be replayed elsewhere. Tokens are
cached per requested scope and never logged. This mirrors the orchestrator's
`ServiceTokenClient` so behaviour is identical across planes.
"""

from __future__ import annotations

import time

import httpx

_EXPIRY_SKEW_S = 15
_TIMEOUT_S = 10.0


class ServiceTokenError(RuntimeError):
    pass


class ServiceTokenClient:
    """OAuth2 client_credentials minting with per-scope caching."""

    def __init__(
        self,
        *,
        token_url: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
    ) -> None:
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._default_scope = scope
        self._cache: dict[str | None, tuple[str, float]] = {}

    def get_token(self, scope: str | None = None) -> str:
        requested_scope = scope if scope is not None else self._default_scope
        now = time.monotonic()
        cached = self._cache.get(requested_scope)
        if cached is not None and cached[1] - _EXPIRY_SKEW_S > now:
            return cached[0]

        if not self._client_secret:
            raise ServiceTokenError("service client secret is not configured")

        data = {
            "grant_type": "client_credentials",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
        }
        if requested_scope:
            data["scope"] = requested_scope

        try:
            response = httpx.post(
                self._token_url,
                data=data,
                headers={"Accept": "application/json"},
                timeout=_TIMEOUT_S,
            )
        except httpx.HTTPError as exc:
            raise ServiceTokenError("service token request failed") from exc

        if response.status_code != 200:
            raise ServiceTokenError("failed to obtain a service token")

        body = response.json()
        access_token = body.get("access_token")
        if not access_token:
            raise ServiceTokenError("token response did not include an access token")

        self._cache[requested_scope] = (str(access_token), now + float(body.get("expires_in", 60)))
        return str(access_token)

    def invalidate(self, scope: str | None = None) -> None:
        if scope is None and self._default_scope is None:
            self._cache.clear()
            return
        self._cache.pop(scope if scope is not None else self._default_scope, None)
