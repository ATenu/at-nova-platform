"""The LLM reasoning port for the autonomous orchestration graph.

The ``Reasoner`` Protocol is the ONLY place model judgment enters orchestration:
nodes call it and validate the typed result before acting. The OpenAI-backed
implementation is a drop-in; tests inject a deterministic fake. The reasoner
NEVER authorizes — it proposes a next action from the Layer A menu it is shown,
and the Layer B gate re-checks every hop in code regardless of model output.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, SecretStr

from . import prompts
from .dag import MenuItem, Observation


class ReasonDecision(BaseModel):
    """The orchestrator's next-step decision."""

    action: Literal["tool", "agent", "finish"]
    capability_id: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""
    note: str = ""


class OrchestratorCritique(BaseModel):
    """Whether the observations now answer the request."""

    satisfied: bool
    missing: str | None = None
    should_continue: bool = True


class Reasoner(Protocol):
    """Synchronous LLM judgment surface used by the orchestration graph."""

    def reason(
        self,
        *,
        prompt: str,
        menu: Sequence[MenuItem],
        observations: Sequence[Observation],
    ) -> ReasonDecision: ...

    def critique(
        self, *, prompt: str, observations: Sequence[Observation]
    ) -> OrchestratorCritique: ...

    def compose(self, *, prompt: str, observations: Sequence[Observation]) -> str: ...


class ReasonerError(RuntimeError):
    """Raised when the model is unavailable or returns an unusable response."""


_TModel = TypeVar("_TModel", bound=BaseModel)


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
        from langchain_openai import ChatOpenAI

        self._llm = ChatOpenAI(
            model=model,
            temperature=temperature,
            timeout=timeout_s,
            api_key=SecretStr(api_key),
            base_url=base_url,
            max_retries=2,
        )

    def _structured(self, schema: type[_TModel], system: str, user: str) -> _TModel:
        from langchain_core.messages import HumanMessage, SystemMessage

        runnable = self._llm.with_structured_output(schema)
        result = runnable.invoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        if not isinstance(result, schema):
            raise ReasonerError("model returned an unexpected response shape")
        return result

    def reason(
        self,
        *,
        prompt: str,
        menu: Sequence[MenuItem],
        observations: Sequence[Observation],
    ) -> ReasonDecision:
        return self._structured(
            ReasonDecision,
            prompts.REASON_SYSTEM,
            prompts.reason_user(prompt=prompt, menu=menu, observations=observations),
        )

    def critique(
        self, *, prompt: str, observations: Sequence[Observation]
    ) -> OrchestratorCritique:
        return self._structured(
            OrchestratorCritique,
            prompts.CRITIQUE_SYSTEM,
            prompts.critique_user(prompt=prompt, observations=observations),
        )

    def compose(self, *, prompt: str, observations: Sequence[Observation]) -> str:
        from langchain_core.messages import HumanMessage, SystemMessage

        user = prompts.compose_user(prompt=prompt, observations=observations)
        message = self._llm.invoke(
            [
                SystemMessage(content=prompts.COMPOSE_SYSTEM),
                HumanMessage(content=user),
            ]
        )
        content = message.content
        return content if isinstance(content, str) else str(content)
