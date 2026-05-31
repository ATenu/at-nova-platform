"""MCP client to the DB MCP server (the agent's read-only data channel).

Speaks the native MCP Streamable HTTP protocol via the official ``mcp`` Python
SDK. One client instance per run: the session carries the audience-restricted
token (``aud: nova-mcp-data``) and the run id so the server can fetch and
re-verify the entitlement snapshot. The agent treats every tool result as
untrusted data and can only ever reach the curated, server-validated views.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

from ..auth.tokens import ServiceTokenClient

if TYPE_CHECKING:
    from mcp import ClientSession

_DESCRIBE_TOOL = "describe_schema"
_SELECT_TOOL = "run_select_query"


class DataClientError(RuntimeError):
    """Raised when the data channel is unavailable or a tool call is rejected."""


class DataClient(Protocol):
    """The read-only data surface the harness depends on (mockable in tests)."""

    async def describe_schema(self) -> list[dict[str, Any]]: ...

    async def run_select_query(
        self, sql: str, params: list[Any] | None = None
    ) -> dict[str, Any]: ...

    async def aclose(self) -> None: ...


class McpDataClient:
    """Concrete async MCP client over Streamable HTTP."""

    def __init__(
        self,
        *,
        base_url: str,
        run_id: str,
        tokens: ServiceTokenClient,
        audience_scope: str,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/mcp"
        self._run_id = run_id
        self._tokens = tokens
        self._scope = audience_scope
        self._session: ClientSession | None = None
        self._stack: Any | None = None

    async def describe_schema(self) -> list[dict[str, Any]]:
        result = await self._call(_DESCRIBE_TOOL, {})
        views = result.get("views")
        return list(views) if isinstance(views, list) else []

    async def run_select_query(
        self, sql: str, params: list[Any] | None = None
    ) -> dict[str, Any]:
        arguments: dict[str, Any] = {"sql": sql}
        if params:
            arguments["params"] = params
        return await self._call(_SELECT_TOOL, arguments)

    async def aclose(self) -> None:
        if self._stack is not None:
            import contextlib

            # Best-effort teardown: a transport error while closing is not fatal.
            with contextlib.suppress(Exception):
                await self._stack.aclose()
            self._stack = None
            self._session = None

    async def _ensure_session(self) -> ClientSession:
        if self._session is not None:
            return self._session
        from contextlib import AsyncExitStack

        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        token = self._tokens.get_token(self._scope)
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Nova-Run-Id": self._run_id,
        }
        stack = AsyncExitStack()
        try:
            read, write, _ = await stack.enter_async_context(
                streamablehttp_client(self._url, headers=headers)
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
        except Exception as exc:  # noqa: BLE001 - normalise any transport failure
            await stack.aclose()
            raise DataClientError("could not establish the data MCP session") from exc
        self._stack = stack
        self._session = session
        return session

    async def _call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        session = await self._ensure_session()
        try:
            result = await session.call_tool(name, arguments)
        except Exception as exc:  # noqa: BLE001 - the data hop is an untrusted boundary
            raise DataClientError("data tool call failed") from exc
        if getattr(result, "isError", False):
            raise DataClientError("data tool reported an error")
        structured = getattr(result, "structuredContent", None)
        if structured is None:
            structured = getattr(result, "structured_content", None)
        return structured if isinstance(structured, dict) else {}
