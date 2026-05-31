"""Per-hop OAuth2 client_credentials token minting for the execution plane.

The worker mints short-lived, audience-restricted service tokens
(``nova-agent-<name>`` / ``nova-mcp-<name>``) so a token minted for one resource
cannot be replayed against another. Tokens are cached until shortly before
expiry and never logged.
"""

from __future__ import annotations

import time

import httpx

_EXPIRY_SKEW_S = 15
_TIMEOUT_S = 10.0


class ServiceTokenError(RuntimeError):
    pass


class ServiceTokenClient:
    """OAuth2 client_credentials minting with per-scope caching.

    A ``scope`` may be requested so that, where the realm exposes per-audience
    client scopes (decision D5), each minted token can be narrowed to a single
    target audience. Tokens are cached per requested scope so segregated targets
    never share a cache entry. Where the realm injects audiences via protocol
    mappers instead, ``scope`` is a no-op and ``azp`` pinning at each resource
    server remains the authoritative second control.
    """

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
        # Cache keyed by the requested scope (None for "no explicit scope").
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
