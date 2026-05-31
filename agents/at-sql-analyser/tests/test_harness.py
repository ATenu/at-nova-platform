"""Read-path graph tests: drive the compiled LangGraph DAG with a FakeReasoner."""

from __future__ import annotations

from collections.abc import Sequence

from at_sql_analyser.harness.graph import GraphDeps, run_task
from at_sql_analyser.harness.guards import GuardLimits
from at_sql_analyser.harness.llm import QueryDecision, ReadCritique
from at_sql_analyser.harness.state import QueryAttempt, SchemaView, TaskInput

from .fakes import FakeClock, FakeDataClient, FakeReasoner, read_query

LIMITS = GuardLimits(max_iterations=5, max_queries=5, total_timeout_s=30.0)


def _task() -> TaskInput:
    return TaskInput(
        run_id="r",
        correlation_id="c",
        skill_id="data.analyse.read",
        goal="how many sales",
        intent="read",
    )


async def test_runs_scripted_query_and_completes() -> None:
    data = FakeDataClient()
    reasoner = FakeReasoner(
        queries=[read_query("SELECT count(*) FROM mcp_read.sales")],
        answer="There are 1 sales.",
    )
    deps = GraphDeps(reasoner=reasoner, limits=LIMITS, data_client=data)
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    assert result.answer == "There are 1 sales."
    assert result.query_count == 1
    assert data.closed is False  # graph does not own client lifecycle


async def test_finish_without_query() -> None:
    data = FakeDataClient()
    reasoner = FakeReasoner(queries=[], answer="nothing to do")
    deps = GraphDeps(reasoner=reasoner, limits=LIMITS, data_client=data)
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    assert result.answer == "nothing to do"
    assert result.query_count == 0
    assert data.calls == []


async def test_emits_pii_free_events() -> None:
    data = FakeDataClient()
    seen: list[tuple[str, dict[str, object]]] = []
    deps = GraphDeps(
        reasoner=FakeReasoner(queries=[read_query("SELECT 1 FROM mcp_read.sales")], answer="ok"),
        limits=LIMITS,
        data_client=data,
        on_event=lambda t, p: seen.append((t, p)),
    )
    await run_task(_task(), deps)
    types = [t for t, _ in seen]
    assert "agent.query.started" in types and "agent.completed" in types
    for _, payload in seen:
        assert "sql" not in payload
        assert "rows" not in payload


async def test_timeout_guard_terminates_loop() -> None:
    clock = FakeClock()

    class TimeoutReasoner(FakeReasoner):
        async def propose_query(
            self,
            *,
            goal: str,
            schema: Sequence[SchemaView],
            history: Sequence[QueryAttempt],
        ) -> QueryDecision:
            clock.advance(20.0)
            return read_query(f"SELECT {len(history)} FROM mcp_read.sales")

        async def critique(
            self, *, goal: str, history: Sequence[QueryAttempt]
        ) -> ReadCritique:
            return ReadCritique(satisfied=False, refine_hint="more")

    deps = GraphDeps(
        reasoner=TimeoutReasoner(answer=""),
        limits=GuardLimits(max_iterations=100, max_queries=100, total_timeout_s=30.0),
        data_client=FakeDataClient(),
        clock=clock.monotonic,
    )
    result = await run_task(_task(), deps)
    assert result.status == "failed"
    assert result.reason in {"time_budget_exhausted", "no_progress", "no_answer"}
