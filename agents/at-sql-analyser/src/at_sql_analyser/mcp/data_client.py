"""MCP client to the DB MCP server (the agent's read-only data channel).

Speaks the native MCP Streamable HTTP protocol via the official ``mcp`` Python
SDK. One client instance per run: the session carries the audience-restricted
token (``aud: nova-mcp-data``) and the run id so the server can fetch and
re-verify the entitlement snapshot. The agent treats every tool result as
untrusted data and can only ever reach the curated, server-validated views.

Native protocol flow per run: ``initialize`` -> ``tools/list`` -> ``tools/call``.
The harness discovers the live tool surface from ``tools/list`` and dispatches
generically via ``call_tool``; it never hardcodes which tools exist.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from ..auth.tokens import ServiceTokenClient

if TYPE_CHECKING:
    from mcp import ClientSession

_DESCRIBE_TOOL = "describe_schema"
_SELECT_TOOL = "run_select_query"
_SCHEMA_TOOLS = frozenset({_DESCRIBE_TOOL, "list_views"})


@dataclass(frozen=True)
class McpTool:
    """One tool advertised by the MCP server via ``tools/list``."""

    name: str
    description: str
    input_schema: dict[str, Any]


class DataClientError(RuntimeError):
    """Raised when the data channel is unavailable or a tool call is rejected."""


class DataClient(Protocol):
    """The read-only data surface the harness depends on (mockable in tests)."""

    async def list_tools(self) -> tuple[McpTool, ...]: ...

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]: ...

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

    async def list_tools(self) -> tuple[McpTool, ...]:
        session = await self._ensure_session()
        try:
            result = await session.list_tools()
        except Exception as exc:  # noqa: BLE001 - discovery is fail-soft at the harness
            raise DataClientError("could not list MCP tools") from exc
        tools: list[McpTool] = []
        for tool in getattr(result, "tools", ()) or ():
            name = getattr(tool, "name", None)
            if not isinstance(name, str) or not name:
                continue
            description = getattr(tool, "description", None)
            schema = getattr(tool, "inputSchema", None)
            if schema is None:
                schema = getattr(tool, "input_schema", None)
            tools.append(
                McpTool(
                    name=name,
                    description=description if isinstance(description, str) else "",
                    input_schema=schema if isinstance(schema, dict) else {},
                )
            )
        return tuple(tools)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await self._call(name, arguments)

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
            # Surface the server's caller-safe reason (e.g.
            # "sql_rejected: Relation \"mcp_read.orders\" is not in the mcp_read
            # allowlist.") so the harness records it and the LLM critique can
            # self-correct, instead of looping on a generic failure. The message
            # is curated server-side and never contains SQL text, params, or rows.
            raise DataClientError(_error_detail(result) or "data tool reported an error")
        structured = getattr(result, "structuredContent", None)
        if structured is None:
            structured = getattr(result, "structured_content", None)
        return structured if isinstance(structured, dict) else {}


def schema_tool_names(tools: tuple[McpTool, ...]) -> frozenset[str]:
    """Names of schema-discovery tools present in a discovered tool set."""
    return frozenset(tool.name for tool in tools if tool.name in _SCHEMA_TOOLS)


def _error_detail(result: object) -> str:
    """Extract the caller-safe ``{error, message}`` an MCP tool returns on error.

    The DB MCP server returns errors as a single text content part holding
    ``{"error": <code>, "message": <safe message>}``. We parse that to a short,
    bounded reason; anything unexpected yields an empty string (the caller then
    falls back to a generic message). Never raises.
    """
    content = getattr(result, "content", None)
    if not isinstance(content, list):
        return ""
    for item in content:
        text = getattr(item, "text", None)
        if not isinstance(text, str) or not text:
            continue
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            return text[:256]
        if isinstance(data, dict):
            code = data.get("error")
            message = data.get("message")
            if isinstance(code, str) and isinstance(message, str):
                return f"{code}: {message}"[:256]
            if isinstance(message, str):
                return message[:256]
            if isinstance(code, str):
                return code[:256]
    return ""
