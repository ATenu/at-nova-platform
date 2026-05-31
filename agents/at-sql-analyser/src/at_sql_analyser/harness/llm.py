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


class QueryDecision(BaseModel):
    """The planner's next-step decision: run one SELECT, or finish."""

    action: Literal["query", "finish"]
    sql: str = ""
    params: list[str] = Field(default_factory=list)
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

    async def propose_query(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        history: Sequence[QueryAttempt],
    ) -> QueryDecision: ...

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

    async def propose_query(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        history: Sequence[QueryAttempt],
    ) -> QueryDecision:
        return await self._structured(
            QueryDecision,
            prompts.PROPOSE_QUERY_SYSTEM,
            prompts.propose_query_user(goal=goal, schema=schema, history=history),
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
