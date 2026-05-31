"""Deterministic test doubles for the graph and A2A server (no network, no LLM).

The ``FakeReasoner`` stands in for the OpenAI-backed ``Reasoner`` so the compiled
LangGraph DAG runs offline and deterministically. It only ever *proposes*; the
graph's guards, local validation, and Layer B authorization are exercised for
real against these proposals.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from at_sql_analyser.auth.resource_server import VerifiedCaller
from at_sql_analyser.auth.snapshot import VerifiedSnapshot
from at_sql_analyser.harness.llm import (
    QueryDecision,
    ReadCritique,
    WriteItem,
    WritePlan,
)
from at_sql_analyser.harness.state import QueryAttempt, SchemaView, WriteOutcome
from at_sql_analyser.tools.capability_client import CapabilityClientError, CapabilityResult


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def monotonic(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class FakeReasoner:
    """Scripts the LLM judgment surface deterministically.

    ``queries`` are proposed one per iteration (indexed by history length); once
    exhausted the planner ``finish``es. ``critique`` reports satisfied once all
    scripted queries have run. ``writes`` are proposed verbatim (so the graph's
    per-action Layer B gate decides what actually dispatches).
    """

    def __init__(
        self,
        *,
        queries: Sequence[QueryDecision] = (),
        answer: str = "done",
        writes: Sequence[WriteItem] = (),
    ) -> None:
        self._queries = list(queries)
        self._answer = answer
        self._writes = list(writes)
        self.seen_authorized_writes: list[tuple[str, ...]] = []
        self.seen_conversation_history: str = ""

    async def propose_query(
        self,
        *,
        goal: str,
        schema: Sequence[SchemaView],
        history: Sequence[QueryAttempt],
        conversation_history: str = "",
    ) -> QueryDecision:
        self.seen_conversation_history = conversation_history
        index = len(history)
        if index < len(self._queries):
            return self._queries[index]
        return QueryDecision(action="finish")

    async def critique(
        self, *, goal: str, history: Sequence[QueryAttempt]
    ) -> ReadCritique:
        if len(history) >= len(self._queries):
            return ReadCritique(satisfied=True, answer=self._answer)
        return ReadCritique(satisfied=False, refine_hint="need more data")

    async def compose(self, *, goal: str, history: Sequence[QueryAttempt]) -> str:
        return self._answer

    async def plan_writes(
        self, *, goal: str, authorized_writes: Sequence[str]
    ) -> WritePlan:
        self.seen_authorized_writes.append(tuple(authorized_writes))
        return WritePlan(writes=list(self._writes))

    async def compose_writes(
        self, *, goal: str, outcomes: Sequence[WriteOutcome]
    ) -> str:
        if not outcomes:
            return ""
        if any(o.status == "completed" for o in outcomes):
            return "Completed the requested actions."
        return ""


def read_query(sql: str) -> QueryDecision:
    return QueryDecision(action="query", sql=sql, params=[], rationale="test")


class FakeDataClient:
    """Async stand-in for the MCP data channel. Scripts schema + per-sql results."""

    def __init__(
        self,
        *,
        schema: list[dict[str, Any]] | None = None,
        results: dict[str, dict[str, Any]] | None = None,
        error_sql: set[str] | None = None,
    ) -> None:
        self._schema = schema if schema is not None else [
            {"name": "mcp_read.sales", "description": "sales", "columns": [{"name": "amount"}]}
        ]
        self._results = results or {}
        self._error_sql = error_sql or set()
        self.closed = False
        self.calls: list[str] = []

    async def describe_schema(self) -> list[dict[str, Any]]:
        return self._schema

    async def run_select_query(
        self, sql: str, params: list[Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append(sql)
        if sql in self._error_sql:
            from at_sql_analyser.mcp.data_client import DataClientError

            raise DataClientError("rejected")
        default = {
            "sqlHash": "sha256:x",
            "rowCount": 1,
            "truncated": False,
            "rows": [{"amount": 10}],
        }
        return self._results.get(sql, default)

    async def aclose(self) -> None:
        self.closed = True


class FakeCapabilityClient:
    def __init__(
        self,
        *,
        results: dict[str, CapabilityResult] | None = None,
        error_caps: set[str] | None = None,
    ) -> None:
        self._results = results or {}
        self._error_caps = error_caps or set()
        self.calls: list[tuple[str, str]] = []

    async def execute(
        self,
        *,
        run_id: str,
        capability_id: str,
        tool_input: dict[str, Any],
        idempotency_key: str,
    ) -> CapabilityResult:
        self.calls.append((capability_id, idempotency_key))
        if capability_id in self._error_caps:
            raise CapabilityClientError("denied", status_code=403)
        return self._results.get(capability_id, CapabilityResult(summary=f"did {capability_id}"))


class FakeResourceServer:
    def __init__(self, caller: VerifiedCaller | None = None) -> None:
        self._caller = caller or VerifiedCaller(azp="nova-celery-worker", subject="worker")

    def verify(self, authorization_header: str) -> VerifiedCaller:
        from at_sql_analyser.auth.resource_server import AuthError

        if not authorization_header:
            raise AuthError("missing")
        return self._caller


class FakeSnapshotClient:
    def __init__(self, snapshot: VerifiedSnapshot) -> None:
        self._snapshot = snapshot
        self.error: Exception | None = None

    def fetch_verified(self, run_id: str, *, now: datetime | None = None) -> VerifiedSnapshot:
        if self.error is not None:
            raise self.error
        return self._snapshot


def make_snapshot(
    *,
    roles: tuple[str, ...] = ("ops-compliance",),
    allowlist: tuple[str, ...] = ("data.analyse.read",),
) -> VerifiedSnapshot:
    return VerifiedSnapshot(
        run_id="run-1",
        owner_subject="user-1",
        roles=roles,
        permissions=frozenset({"read-data"}),
        capability_allowlist=frozenset(allowlist),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
