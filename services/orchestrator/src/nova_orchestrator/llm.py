"""The LLM reasoning port for the autonomous orchestration graph.

The reasoner invokes authorized capabilities as native LLM tools (OpenAI tool
calling). Layer A bounds the tool list; Layer B re-checks every hop in code.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, SecretStr

from . import prompts
from .capability_guide import FINISH_TOOL_NAME, finish_tool_schema, spec_for
from .dag import MenuItem, Observation

if TYPE_CHECKING:
    from langchain_core.messages import BaseMessage


class ReasonDecision(BaseModel):
    """The orchestrator's next-step decision (parsed from a tool call)."""

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


def tools_for_menu(menu: Sequence[MenuItem], *, include_finish: bool) -> list[dict[str, Any]]:
    """Build OpenAI-compatible tool definitions from the Layer A menu."""
    tools: list[dict[str, Any]] = []
    for item in menu:
        guide = spec_for(item.capability_id)
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": item.tool_name,
                    "description": f"{guide.summary} When to use: {guide.when_to_use}",
                    "parameters": guide.input_schema,
                },
            }
        )
    if include_finish:
        tools.append(finish_tool_schema())
    return tools


def parse_tool_decision(
    tool_calls: Sequence[Any], menu: Sequence[MenuItem]
) -> ReasonDecision:
    """Map the model's tool call to a typed orchestration decision."""
    if not tool_calls:
        return ReasonDecision(
            action="finish",
            note="model returned no tool call",
            rationale="no tool call",
        )
    call = tool_calls[0]
    name = str(call.get("name", "") if isinstance(call, dict) else getattr(call, "name", ""))
    raw_args = call.get("args", {}) if isinstance(call, dict) else getattr(call, "args", {})
    args = dict(raw_args) if isinstance(raw_args, dict) else {}

    if name == FINISH_TOOL_NAME:
        note = str(args.get("note", ""))
        return ReasonDecision(action="finish", note=note, rationale=note)

    by_tool = {item.tool_name: item for item in menu}
    item = by_tool.get(name)
    if item is None:
        return ReasonDecision(
            action="finish",
            note="selected tool is not in the authorized menu",
            rationale="invalid tool",
        )

    route: Literal["tool", "agent"] = "agent" if item.kind == "agent-skill" else "tool"
    return ReasonDecision(
        action=route,
        capability_id=item.capability_id,
        input=args,
        rationale=f"tool {name}",
    )


class OpenAIReasoner:
    """OpenAI-backed reasoner using native tool calling for capability selection."""

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
        from langchain_core.messages import AIMessage

        if not menu:
            return ReasonDecision(
                action="finish",
                note="no authorized tools available",
                rationale="empty menu",
            )

        # ``finish_orchestration`` is ALWAYS offered so the model can decline to
        # act on a non-actionable request (greeting/small talk) instead of being
        # forced into an unrelated tool. On the first turn we still REQUIRE a tool
        # call so the model commits to a decision rather than free-texting; for
        # any data/action request the prompt steers it to the matching capability.
        obs_empty = len(observations) == 0
        tools = tools_for_menu(menu, include_finish=True)
        user = prompts.reason_user(prompt=prompt, menu=menu, observations=observations)
        tool_choice = "required" if obs_empty else "auto"
        message = self._invoke_reason(tools, tool_choice, user)
        if not isinstance(message, AIMessage):
            raise ReasonerError("model returned a non-assistant message")
        return parse_tool_decision(message.tool_calls or [], menu)

    def _invoke_reason(
        self, tools: list[dict[str, Any]], tool_choice: str, user: str
    ) -> BaseMessage:
        """Invoke the tool-calling model, tolerating backends that reject
        ``tool_choice="required"`` (some Azure / OpenAI-compatible API versions)
        by retrying once with ``"auto"``.
        """
        from langchain_core.messages import HumanMessage, SystemMessage

        messages = [SystemMessage(content=prompts.REASON_SYSTEM), HumanMessage(content=user)]
        try:
            return self._llm.bind_tools(tools, tool_choice=tool_choice).invoke(messages)
        except Exception as exc:  # noqa: BLE001 - normalise any backend/transport failure
            if tool_choice == "required":
                try:
                    return self._llm.bind_tools(tools, tool_choice="auto").invoke(messages)
                except Exception as retry_exc:  # noqa: BLE001
                    raise ReasonerError("reasoner tool-calling request failed") from retry_exc
            raise ReasonerError("reasoner tool-calling request failed") from exc

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
