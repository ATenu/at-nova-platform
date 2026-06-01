"""Deterministic test doubles for the orchestration graph (no network, no LLM)."""

from __future__ import annotations

from collections.abc import Sequence

from nova_orchestrator.dag import MenuItem, Observation
from nova_orchestrator.llm import OrchestratorCritique, ReasonDecision


class FakeReasoner:
    """Scripts the orchestrator's LLM judgment surface deterministically.

    ``decisions`` are returned one per ``reason`` call; once exhausted it
    ``finish``es. ``satisfied`` controls the critique verdict. The fake records
    the menu it was shown so tests can assert it only ever proposes Layer-A
    actions.
    """

    def __init__(
        self,
        *,
        decisions: Sequence[ReasonDecision] = (),
        satisfied: bool = True,
        answer: str = "Here is your answer.",
    ) -> None:
        self._decisions = list(decisions)
        self._satisfied = satisfied
        self._answer = answer
        self._reason_calls = 0
        self.seen_menus: list[tuple[str, ...]] = []
        self.seen_history: list[str] = []

    def reason(
        self,
        *,
        prompt: str,
        menu: Sequence[MenuItem],
        observations: Sequence[Observation],
        history: str = "",
    ) -> ReasonDecision:
        self.seen_menus.append(tuple(item.capability_id for item in menu))
        self.seen_history.append(history)
        index = self._reason_calls
        self._reason_calls += 1
        if index < len(self._decisions):
            return self._decisions[index]
        return ReasonDecision(action="finish")

    def critique(
        self, *, prompt: str, observations: Sequence[Observation], history: str = ""
    ) -> OrchestratorCritique:
        return OrchestratorCritique(satisfied=self._satisfied, should_continue=not self._satisfied)

    def compose(
        self, *, prompt: str, observations: Sequence[Observation], history: str = ""
    ) -> str:
        return self._answer
