"""Typed value objects and the LangGraph state schema.

No raw SQL or row data ever leaves the agent in events/logs/traces: only the
hash and row metadata are surfaced. Rows are held in-process solely so the
compose/critique LLM nodes can ground an answer in the (server-side redacted)
results.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Literal, TypedDict


@dataclass(frozen=True)
class SchemaView:
    name: str
    description: str
    columns: tuple[str, ...]


@dataclass(frozen=True)
class QueryAttempt:
    """One executed (or rejected) read step. ``sql``/``rows`` stay in-process
    only; only the hash + row metadata are ever surfaced in events/logs.

    A read step is one of TWO families, distinguished by ``source``:
      - ``"sql"`` (default): a free-form SELECT over the curated ``mcp_read``
        views via the DB MCP server; ``sql`` holds the statement.
      - ``"capability"``: a structured, cataloged read capability dispatched via
        the Node gateway (e.g. ``customers.search`` -> ``sales.report.customer``);
        ``capability_id`` is set and ``sql`` holds a human label, not SQL.
    Both flow through the same guards/critique/compose so the loop stays bounded
    and the planner can ground (and resolve ids) from prior ``rows``.
    """

    sql: str
    sql_hash: str | None
    row_count: int
    truncated: bool
    error: str | None
    rows: tuple[dict[str, Any], ...] = ()
    source: Literal["sql", "capability"] = "sql"
    capability_id: str | None = None


@dataclass(frozen=True)
class CapabilityCall:
    """A concrete, cataloged write capability the agent proposes to invoke.

    The agent never writes raw SQL: a write is always a typed capability id plus
    a validated input, dispatched through the control-plane gateway and gated
    independently on its own permission.
    """

    capability_id: str
    tool_input: dict[str, Any]
    rationale: str = ""


@dataclass(frozen=True)
class WriteOutcome:
    capability_id: str
    status: Literal["completed", "denied", "failed"]
    summary: str
    reason: str | None = None
    links: tuple[dict[str, str], ...] = ()


@dataclass(frozen=True)
class TaskInput:
    """The validated task the harness runs (built from the A2A message)."""

    run_id: str
    correlation_id: str
    skill_id: str
    goal: str
    intent: Literal["read", "write"]
    approval_granted: bool = False
    conversation_id: str = ""
    # W3C trace identifiers supplied by the orchestrator so this task JOINS the
    # run's shared Langfuse trace. Ids only (no tokens/PII); empty when absent.
    langfuse_trace_id: str = ""
    langfuse_parent_observation_id: str = ""


@dataclass(frozen=True)
class AgentResult:
    status: Literal["completed", "failed", "denied", "needs_approval"]
    answer: str | None
    reason: str | None
    query_count: int


def _append_attempt(
    current: list[QueryAttempt], new: list[QueryAttempt]
) -> list[QueryAttempt]:
    return [*current, *new]


class GraphState(TypedDict, total=False):
    """LangGraph state. ``attempts`` uses an append reducer so nodes contribute
    deltas; every other field is last-value (a node overwrites it)."""

    run_id: str
    goal: str
    intent: Literal["read", "write"]
    started_monotonic: float
    schema: tuple[SchemaView, ...]
    attempts: Annotated[list[QueryAttempt], _append_attempt]
    iteration: int
    route: str
    pending_sql: str
    pending_params: list[str]
    skip_execute: bool
    # The structured read capability the planner chose this turn (resolver /
    # detail read / scoped report); dispatched + re-gated in ``dispatch_read``.
    pending_read: CapabilityCall | None
    write_calls: list[CapabilityCall]
    write_outcomes: list[WriteOutcome]
    # True when RBAC entitled at least one concrete write capability this run.
    entitled_writes: bool
    answer: str | None
    reason: str | None
    status: Literal["completed", "failed", "denied", "needs_approval"]
