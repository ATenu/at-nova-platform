"""Typed value objects and the LangGraph state schema for the orchestrator.

The reasoner only ever sees these de-identified projections: the Layer A menu
(capability descriptors) and observations (capability id + status + a short,
safe summary). No tokens, snapshots, raw SQL, or PII ever reach the model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict


@dataclass(frozen=True)
class MenuItem:
    """One Layer-A-authorized action shown to the reasoner (the only menu)."""

    capability_id: str
    kind: str
    mode: str
    resource_scoped: bool


@dataclass(frozen=True)
class Observation:
    """A safe, de-identified record of one executed hop, for the LLM + compose."""

    capability_id: str
    kind: str  # 'tool' | 'agent'
    status: str  # 'completed' | 'failed' | 'denied'
    summary: str = ""
    reason: str | None = None
    links: list[dict[str, str]] = field(default_factory=list)


def _append_observation(
    current: list[Observation], new: list[Observation]
) -> list[Observation]:
    base = current if isinstance(current, list) else []
    return [*base, *new]


class OrchestrationState(TypedDict, total=False):
    """LangGraph state. ``observations`` appends; other fields are last-value."""

    run_id: str
    prompt: str
    iteration: int
    route: str
    decision_action: str
    decision_capability: str
    decision_input: dict[str, Any]
    observations: Annotated[list[Observation], _append_observation]
    answer: str | None
    status: str
    canceled: bool
