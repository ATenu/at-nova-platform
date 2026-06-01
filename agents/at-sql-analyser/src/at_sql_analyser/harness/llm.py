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

from collections.abc import Sequence
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, SecretStr

from .. import prompts
from .state import QueryAttempt, SchemaView, WriteOutcome


class ReadStep(BaseModel):
    """The read planner's next step in the bounded ReAct loop.

    The agent owns ALL concrete read selection: each turn it picks ONE of two
    tool families (or finishes):
      - ``"sql"``: run one free-form read-only SELECT (``sql``/``params``) over
        the curated ``mcp_read`` views (only offered when SQL is available, i.e.
        the caller holds ``read-data``);
      - ``"capability"``: invoke ONE entitled structured read capability
        (``capability_id`` from the authorized closed set, with ``input`` built
        from the goal/observations — e.g. resolve a name via ``customers.search``
        then read with the returned id);
      - ``"finish"``: enough has been gathered (or nothing applies).
    Selecting an action is a request, not authorization: Layer B re-gates every
    concrete capability and the DB MCP server re-validates every SELECT.
    """

    action: Literal["sql", "capability", "finish"]
    sql: str = ""
    params: list[str] = Field(default_factory=list)
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


class WritePlan(BaseModel):
    writes: list[WriteItem] = Field(default_factory=list)


_TModel = TypeVar("_TModel", bound=BaseModel)


class Reasoner(Protocol):
    """Async LLM judgment surface used by the graph nodes."""

    async def plan_read_step(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        authorized_reads: Sequence[str],
        history: Sequence[QueryAttempt],
        sql_enabled: bool,
        conversation_history: str = "",
    ) -> ReadStep: ...

    async def critique(
        self, *, goal: str, history: Sequence[QueryAttempt]
    ) -> ReadCritique: ...

    async def compose(self, *, goal: str, history: Sequence[QueryAttempt]) -> str: ...

    async def plan_writes(
        self, *, goal: str, authorized_writes: Sequence[str]
    ) -> WritePlan: ...

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

        runnable = self._llm.with_structured_output(schema)
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
        authorized_reads: Sequence[str],
        history: Sequence[QueryAttempt],
        sql_enabled: bool,
        conversation_history: str = "",
    ) -> ReadStep:
        return await self._structured(
            ReadStep,
            prompts.PLAN_READ_SYSTEM,
            prompts.plan_read_user(
                goal=goal,
                schema=schema,
                authorized_reads=authorized_reads,
                history=history,
                sql_enabled=sql_enabled,
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

    async def plan_writes(
        self, *, goal: str, authorized_writes: Sequence[str]
    ) -> WritePlan:
        return await self._structured(
            WritePlan,
            prompts.PLAN_WRITES_SYSTEM,
            prompts.plan_writes_user(goal=goal, authorized_writes=authorized_writes),
        )

    async def compose_writes(
        self, *, goal: str, outcomes: Sequence[WriteOutcome]
    ) -> str:
        return await self._text(
            prompts.COMPOSE_SYSTEM,
            prompts.compose_writes_user(goal=goal, outcomes=outcomes),
        )
