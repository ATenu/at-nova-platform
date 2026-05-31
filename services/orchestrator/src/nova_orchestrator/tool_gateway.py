"""Client for the internal MCP tool gateway hosted by the Node control plane.

The worker never touches the business ``nova`` database. To read prompts, run
capabilities, and persist the final assistant message it calls back into the
Node API with an audience-restricted (``nova-mcp-*``) service token. The Node
gateway independently re-enforces authorization against the entitlement
snapshot, so a compromised worker cannot widen access.
"""

from __future__ import annotations

from typing import Any

import httpx

from .tokens import ServiceTokenClient

_TIMEOUT_S = 30.0


class ToolGatewayError(RuntimeError):
    """Raised when the tool gateway returns a non-success response."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ToolGatewayClient:
    def __init__(self, *, base_url: str, tokens: ServiceTokenClient) -> None:
        self._base = base_url.rstrip("/")
        self._tokens = tokens

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._tokens.get_token()}",
            "Accept": "application/json",
        }

    def get_prompt(self, run_id: str) -> str:
        url = f"{self._base}/internal/agent-runs/{run_id}/prompt"
        data = self._request("GET", url)
        return str(data.get("message", ""))

    def execute_capability(
        self, run_id: str, capability_id: str, tool_input: dict[str, Any]
    ) -> dict[str, Any]:
        url = f"{self._base}/internal/agent-runs/{run_id}/tool-calls"
        return self._request(
            "POST", url, json={"capabilityId": capability_id, "input": tool_input}
        )

    def finalize(self, run_id: str, text: str, links: list[dict[str, str]]) -> dict[str, Any]:
        url = f"{self._base}/internal/agent-runs/{run_id}/finalize"
        return self._request("POST", url, json={"text": text, "links": links})

    def _request(
        self, method: str, url: str, *, json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        try:
            response = httpx.request(
                method, url, headers=self._headers(), json=json, timeout=_TIMEOUT_S
            )
        except httpx.HTTPError as exc:
            raise ToolGatewayError("tool gateway request failed") from exc

        if response.status_code == 403:
            # Independent deny by the resource server — never retry, fail closed.
            raise ToolGatewayError("tool gateway denied the capability", status_code=403)
        if response.status_code >= 400:
            raise ToolGatewayError(
                "tool gateway returned an error", status_code=response.status_code
            )

        body = response.json()
        if not isinstance(body, dict):
            raise ToolGatewayError("unexpected tool gateway response shape")
        return body
