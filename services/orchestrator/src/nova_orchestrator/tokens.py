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
    """OAuth2 client_credentials minting with per-audience caching.

    The per-call ``scope`` value names the *target audience* (e.g.
    ``nova-agent-sql-analyst``) and always keys the cache, so tokens for
    segregated targets never share a cache entry.

    Whether that value is also forwarded to the IdP as an OAuth ``scope``
    parameter depends on ``request_audience_scopes``:

    - ``True`` (decision D5): the realm exposes a per-audience *client scope* of
      the same name, so each minted token is narrowed to a single audience.
    - ``False`` (default): the realm injects audiences via protocol mappers on
      the worker client instead. Forwarding an unregistered scope would make the
      IdP reject the request (``invalid_scope``), so it is omitted; the
      mapper-injected ``aud`` plus ``azp`` pinning at each resource server remain
      the authoritative controls.
    """

    def __init__(
        self,
        *,
        token_url: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
        request_audience_scopes: bool = False,
    ) -> None:
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._default_scope = scope
        self._request_audience_scopes = request_audience_scopes
        # Cache keyed by the target audience (None for "no explicit audience").
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
        if requested_scope and self._request_audience_scopes:
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
