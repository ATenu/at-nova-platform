"""The LLM reasoning port for the autonomous SQL-analyst graph.

The ``Reasoner`` Protocol is the ONLY place model judgment enters the harness:
every node calls it and validates the typed result before touching graph state.
Keeping it behind a Protocol means the graph is exercised deterministically in
tests with a fake reasoner, and the OpenAI-backed implementation is a drop-in
that changes no control flow, guardrail, or authorization.

The reasoner NEVER authorizes: it only proposes SQL/decisions/writes from the
catalog it is shown. Layer A (the entitled view/capability set) bounds what it
sees; Layer B (the server + code gate) re-checks every action regardless.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, SecretStr

from .. import prompts
from ..mcp.data_client import McpTool
from .state import QueryAttempt, SchemaView, WriteOutcome

logger = logging.getLogger("at_sql_analyser.harness.llm")


class ReadStep(BaseModel):
    """The read planner's next step in the bounded ReAct loop.

    The agent owns ALL concrete read selection: each turn it picks ONE of two
    tool families (or finishes):
      - ``"mcp_tool"``: invoke ONE tool from the live MCP ``tools/list`` menu
        (``tool_name`` + ``tool_input`` built from the server-published schema);
      - ``"capability"``: invoke ONE entitled structured read capability
        (``capability_id`` from the authorized closed set, with ``input`` built
        from the goal/observations — e.g. resolve a name via ``customers.search``
        then read with the returned id);
      - ``"finish"``: enough has been gathered (or nothing applies).
    Selecting an action is a request, not authorization: Layer B re-gates every
    concrete capability and the DB MCP server re-validates every tool call.
    """

    action: Literal["mcp_tool", "capability", "finish"]
    tool_name: str = ""
    tool_input: dict[str, Any] = Field(default_factory=dict)
    capability_id: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""


class ReadCritique(BaseModel):
    """Whether the gathered results answer the question (and the answer if so)."""

    satisfied: bool
    answer: str | None = None
    refine_hint: str | None = None


class WriteItem(BaseModel):
    capability_id: str
    input: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""


class WriteStep(BaseModel):
    """One step of the write planner's bounded resolve→act loop.

    A write request often references records by a human handle (a name/title),
    not the id the typed capability needs. The write path therefore RESOLVES
    missing inputs autonomously by chaining entitled structured READ capabilities
    (e.g. ``actions.list`` -> read the matching id from its results) before it
    emits the final, fully-populated writes. Each step is one of:
      - ``"read"``: dispatch ONE entitled read capability to resolve a value;
      - ``"write"``: emit the final write plan (>= 1 fully-populated item);
      - ``"finish"``: only when AUTHORIZED WRITES is empty (the harness ignores
        finish while entitled writes exist and forces progress).
    Both reads and writes are independently re-gated (Layer B) before dispatch.
    """

    action: Literal["read", "write", "finish"]
    # action == "read": ONE entitled read capability + its (resolved) input.
    read_capability_id: str = ""
    read_input: dict[str, Any] = Field(default_factory=dict)
    # action == "write": the final, fully-populated write plan.
    writes: list[WriteItem] = Field(default_factory=list)
    rationale: str = ""


class _WriteItemLLM(BaseModel):
    """Model-facing write item.

    The capability ``input`` is requested as a JSON-object STRING rather than a
    free-form ``dict``: a structured-output (function-calling) schema renders a
    bare ``dict[str, Any]`` as an object with no described properties, which
    gpt-4o-mini fills reliably at the TOP level but leaves EMPTY when nested
    inside a list (``writes[].input``) — silently producing an un-executable
    write the typed gateway then rejects (HTTP 400). A string field is filled
    reliably even when nested; we parse it back into a dict here.
    """

    capability_id: str = ""
    input_json: str = "{}"
    rationale: str = ""


class _WriteStepLLM(BaseModel):
    """Model-facing write step (see ``WriteStep``). Inputs are JSON strings for
    the same reliability reason as ``_WriteItemLLM``."""

    action: Literal["read", "write", "finish"] = "finish"
    read_capability_id: str = ""
    read_input_json: str = "{}"
    writes: list[_WriteItemLLM] = Field(default_factory=list)
    rationale: str = ""


def _parse_input_json(raw: str) -> dict[str, Any]:
    """Parse the model's JSON-string input into a dict, failing soft to ``{}``.

    The result is re-validated against the capability's typed schema by the Node
    tool gateway, so a malformed object here simply yields an empty input that
    the gateway will reject — never an unsafe call."""
    if not raw or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        logger.warning("write planner returned non-JSON input; treating as empty")
        return {}
    return parsed if isinstance(parsed, dict) else {}


_TModel = TypeVar("_TModel", bound=BaseModel)


class Reasoner(Protocol):
    """Async LLM judgment surface used by the graph nodes."""

    async def plan_read_step(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        mcp_tools: Sequence[McpTool],
        authorized_reads: Sequence[str],
        history: Sequence[QueryAttempt],
        conversation_history: str = "",
    ) -> ReadStep: ...

    async def critique(
        self, *, goal: str, history: Sequence[QueryAttempt]
    ) -> ReadCritique: ...

    async def compose(self, *, goal: str, history: Sequence[QueryAttempt]) -> str: ...

    async def plan_write_step(
        self,
        *,
        goal: str,
        authorized_reads: Sequence[str],
        authorized_writes: Sequence[str],
        history: Sequence[QueryAttempt],
        conversation_history: str = "",
    ) -> WriteStep: ...

    async def compose_writes(
        self, *, goal: str, outcomes: Sequence[WriteOutcome]
    ) -> str: ...


class ReasonerError(RuntimeError):
    """Raised when the model is unavailable or returns an unusable response."""


class OpenAIReasoner:
    """OpenAI-backed reasoner using structured output for validated decisions."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        temperature: float = 0.0,
        timeout_s: float = 30.0,
        base_url: str | None = None,
    ) -> None:
        if not api_key:
            raise ReasonerError("OPENAI_API_KEY is not configured")
        # Imported lazily so importing the module (e.g. for the Protocol/types)
        # does not require the heavy langchain dependency to be installed.
        from langchain_openai import ChatOpenAI

        self._llm = ChatOpenAI(
            model=model,
            temperature=temperature,
            timeout=timeout_s,
            api_key=SecretStr(api_key),
            base_url=base_url,
            max_retries=2,
        )

    async def _structured(
        self, schema: type[_TModel], system: str, user: str
    ) -> _TModel:
        from langchain_core.messages import HumanMessage, SystemMessage

        # ``function_calling`` (tool calling) over strict ``json_schema``: the
        # decision schemas carry free-form ``dict[str, Any]`` inputs, which the
        # strict structured-output path rejects (additionalProperties must be
        # false) and which makes reasoning backends think far longer. Tool
        # calling is the broadly-compatible path the orchestrator already uses.
        runnable = self._llm.with_structured_output(schema, method="function_calling")
        result = await runnable.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        if not isinstance(result, schema):
            raise ReasonerError("model returned an unexpected response shape")
        return result

    async def _text(self, system: str, user: str) -> str:
        from langchain_core.messages import HumanMessage, SystemMessage

        message = await self._llm.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        content = message.content
        return content if isinstance(content, str) else str(content)

    async def plan_read_step(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        mcp_tools: Sequence[McpTool],
        authorized_reads: Sequence[str],
        history: Sequence[QueryAttempt],
        conversation_history: str = "",
    ) -> ReadStep:
        return await self._structured(
            ReadStep,
            prompts.PLAN_READ_SYSTEM,
            prompts.plan_read_user(
                goal=goal,
                schema=schema,
                mcp_tools=mcp_tools,
                authorized_reads=authorized_reads,
                history=history,
                conversation_history=conversation_history,
            ),
        )

    async def critique(
        self, *, goal: str, history: Sequence[QueryAttempt]
    ) -> ReadCritique:
        return await self._structured(
            ReadCritique,
            prompts.CRITIQUE_SYSTEM,
            prompts.critique_user(goal=goal, history=history),
        )

    async def compose(self, *, goal: str, history: Sequence[QueryAttempt]) -> str:
        return await self._text(
            prompts.COMPOSE_SYSTEM, prompts.compose_user(goal=goal, history=history)
        )

    async def plan_write_step(
        self,
        *,
        goal: str,
        authorized_reads: Sequence[str],
        authorized_writes: Sequence[str],
        history: Sequence[QueryAttempt],
        conversation_history: str = "",
    ) -> WriteStep:
        step = await self._structured(
            _WriteStepLLM,
            prompts.PLAN_WRITE_SYSTEM,
            prompts.plan_write_user(
                goal=goal,
                authorized_reads=authorized_reads,
                authorized_writes=authorized_writes,
                history=history,
                conversation_history=conversation_history,
            ),
        )
        if step.action == "write":
            writes = [
                WriteItem(
                    capability_id=item.capability_id,
                    input=_parse_input_json(item.input_json),
                    rationale=item.rationale,
                )
                for item in step.writes
                if item.capability_id
            ]
            if writes:
                return WriteStep(action="write", writes=writes, rationale=step.rationale)
            return WriteStep(action="finish", rationale=step.rationale)
        if step.action == "read" and step.read_capability_id:
            return WriteStep(
                action="read",
                read_capability_id=step.read_capability_id,
                read_input=_parse_input_json(step.read_input_json),
                rationale=step.rationale,
            )
        return WriteStep(action="finish", rationale=step.rationale)

    async def compose_writes(
        self, *, goal: str, outcomes: Sequence[WriteOutcome]
    ) -> str:
        return await self._text(
            prompts.COMPOSE_SYSTEM,
            prompts.compose_writes_user(goal=goal, outcomes=outcomes),
        )
