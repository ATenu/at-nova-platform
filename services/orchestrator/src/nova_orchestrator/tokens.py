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
    def __init__(self, *, token_url: str, client_id: str, client_secret: str) -> None:
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._cached_value: str | None = None
        self._cached_expiry: float = 0.0

    def get_token(self) -> str:
        now = time.monotonic()
        if self._cached_value is not None and self._cached_expiry - _EXPIRY_SKEW_S > now:
            return self._cached_value

        if not self._client_secret:
            raise ServiceTokenError("worker client secret is not configured")

        try:
            response = httpx.post(
                self._token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
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

        self._cached_value = str(access_token)
        self._cached_expiry = now + float(body.get("expires_in", 60))
        return self._cached_value

    def invalidate(self) -> None:
        self._cached_value = None
        self._cached_expiry = 0.0
