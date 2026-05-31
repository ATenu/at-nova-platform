"""Client to the Node capability tool gateway (the agent's authoritative WRITE path).

Writes are NEVER raw SQL. The agent acts only by invoking already-cataloged,
typed capabilities (decision D3) through the control-plane gateway, which
independently re-enforces the entitlement snapshot. The agent mints an
audience-restricted token for the gateway so the credential cannot be replayed
elsewhere, and carries a per-action idempotency key so a replayed mutation is
safe. Only typed response fields are trusted; internal details never surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from ..auth.tokens import ServiceTokenClient

_TIMEOUT_S = 30.0


class CapabilityClientError(RuntimeError):
    """Raised when the gateway is unreachable or rejects the capability call."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class CapabilityResult:
    summary: str
    links: tuple[dict[str, str], ...] = ()
    # Full structured result of the capability (the gateway's `data`). Surfaced
    # so the write's output can be tracked end to end; it is the user's own
    # entitled business data, never raw SQL or rows.
    data: Any = None


class CapabilityClient(Protocol):
    async def execute(
        self,
        *,
        run_id: str,
        capability_id: str,
        tool_input: dict[str, Any],
        idempotency_key: str,
    ) -> CapabilityResult: ...


class HttpCapabilityClient:
    def __init__(
        self,
        *,
        base_url: str,
        tokens: ServiceTokenClient,
        audience_scope: str,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._tokens = tokens
        self._scope = audience_scope

    async def execute(
        self,
        *,
        run_id: str,
        capability_id: str,
        tool_input: dict[str, Any],
        idempotency_key: str,
    ) -> CapabilityResult:
        token = self._tokens.get_token(self._scope)
        url = f"{self._base}/internal/agent-runs/{run_id}/tool-calls"
        body = {
            "capabilityId": capability_id,
            "input": tool_input,
            "idempotencyKey": idempotency_key,
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                        "Idempotency-Key": idempotency_key,
                    },
                    json=body,
                )
        except httpx.HTTPError as exc:
            raise CapabilityClientError("capability gateway request failed") from exc

        if response.status_code == 401:
            self._tokens.invalidate(self._scope)
        if response.status_code == 403:
            # Independent deny by the control plane — never retry, fail closed.
            raise CapabilityClientError("capability denied by control plane", status_code=403)
        if response.status_code >= 400:
            raise CapabilityClientError(
                "capability gateway returned an error", status_code=response.status_code
            )

        payload = response.json()
        if not isinstance(payload, dict):
            raise CapabilityClientError("unexpected capability gateway response shape")
        summary = payload.get("summary")
        links: list[dict[str, str]] = []
        raw_links = payload.get("links")
        if isinstance(raw_links, list):
            for item in raw_links:
                if isinstance(item, dict):
                    label = item.get("label")
                    href = item.get("href")
                    if isinstance(label, str) and isinstance(href, str):
                        links.append({"label": label, "href": href})
        return CapabilityResult(
            summary=summary if isinstance(summary, str) else "",
            links=tuple(links),
            data=payload.get("data"),
        )
