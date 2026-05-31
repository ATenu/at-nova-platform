"""Typed value objects and the LangGraph state schema for the orchestrator.

The reasoner sees the Layer A menu (capability descriptors) and observations.
An observation carries the capability id, status, a short summary, and the FULL
structured result (``data``) the entitled owner is allowed to retrieve through
that same capability — so the reasoner/composer can ground its answer in the
actual rows, not just a count. Tokens, snapshots, raw SQL, and other secrets
never reach the model: ``safe_io`` strips secret-looking keys and bounds size
before a result becomes an observation. Business data (incl. the owner's own
PII they are entitled to see) is preserved on purpose; see ``content_policy``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict


@dataclass(frozen=True)
class MenuItem:
    """One Layer-A-authorized action shown to the reasoner as an LLM tool."""

    capability_id: str
    kind: str
    mode: str
    resource_scoped: bool
    tool_name: str
    summary: str
    when_to_use: str
    input_fields: tuple[str, ...]


@dataclass(frozen=True)
class Observation:
    """A record of one executed hop, for the reasoner + compose.

    ``data`` is the full, JSON-safe, secret-stripped result the entitled owner
    could retrieve directly through this capability (``safe_io`` already bounds
    size and removes secret-looking keys upstream). It is carried verbatim so
    the composer can ground the final answer in the actual records rather than
    a one-line count; ``None`` when the hop produced no structured payload.
    """

    capability_id: str
    kind: str  # 'tool' | 'agent'
    status: str  # 'completed' | 'failed' | 'denied'
    summary: str = ""
    reason: str | None = None
    links: list[dict[str, str]] = field(default_factory=list)
    data: Any = None


def _append_observation(
    current: list[Observation], new: list[Observation]
) -> list[Observation]:
    base = current if isinstance(current, list) else []
    return [*base, *new]


def _append_attempts(current: list[str], new: list[str]) -> list[str]:
    base = current if isinstance(current, list) else []
    return [*base, *new]


class OrchestrationState(TypedDict, total=False):
    """LangGraph state. ``observations``/``attempts`` append; others are last-value."""

    run_id: str
    prompt: str
    conversation_id: str
    history: str
    iteration: int
    route: str
    decision_action: str
    decision_capability: str
    decision_input: dict[str, Any]
    observations: Annotated[list[Observation], _append_observation]
    attempts: Annotated[list[str], _append_attempts]
    answer: str | None
    status: str
    canceled: bool
