"""Read-path graph tests: drive the compiled LangGraph DAG with a FakeReasoner."""

from __future__ import annotations

from collections.abc import Sequence

from at_sql_analyser.harness.graph import GraphDeps, run_task
from at_sql_analyser.harness.guards import GuardLimits
from at_sql_analyser.harness.llm import ReadCritique, ReadStep
from at_sql_analyser.harness.state import QueryAttempt, SchemaView, TaskInput
from at_sql_analyser.tools.capability_client import CapabilityResult

from .fakes import (
    FakeCapabilityClient,
    FakeClock,
    FakeDataClient,
    FakeReasoner,
    read_capability,
    read_query,
)

LIMITS = GuardLimits(max_iterations=5, max_queries=5, total_timeout_s=30.0)


def _allow_all(_cap: str) -> tuple[bool, str]:
    return True, "allowed"


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


async def test_query_events_carry_tool_input_output_for_the_owner_stream() -> None:
    # The owner's live stream (the harness sink) carries the tool name plus the
    # VERBATIM input (SQL + params) and output (rows). The Langfuse tracer scrubs
    # those nested structures (asserted via `scrub` below + in test_tracing), so
    # the full data only ever travels the owner's own channel.
    from at_sql_analyser.observability.tracing import scrub

    data = FakeDataClient()
    seen: list[tuple[str, dict[str, object]]] = []
    deps = GraphDeps(
        reasoner=FakeReasoner(queries=[read_query("SELECT 1 FROM mcp_read.sales")], answer="ok"),
        limits=LIMITS,
        data_client=data,
        on_event=lambda t, p: seen.append((t, p)),
    )
    await run_task(_task(), deps)
    by_type = {t: p for t, p in seen}
    assert "agent.query.started" in by_type and "agent.completed" in by_type

    started = by_type["agent.query.started"]
    assert started["tool"] == "run_select_query"
    assert started["input"] == {"sql": "SELECT 1 FROM mcp_read.sales", "params": []}

    completed = by_type["agent.query.completed"]
    assert completed["tool"] == "run_select_query"
    assert completed["output"] == {
        "rows": [{"amount": 10}],
        "rowCount": 1,
        "truncated": False,
    }

    # The Langfuse view of every event drops SQL and rows (nested -> "<dict>").
    for _, payload in seen:
        scrubbed = scrub(payload)
        assert "sql" not in scrubbed
        assert "rows" not in scrubbed
        assert scrubbed.get("input", "<dict>") == "<dict>"
        assert scrubbed.get("output", "<dict>") == "<dict>"


async def test_timeout_guard_terminates_loop() -> None:
    clock = FakeClock()

    class TimeoutReasoner(FakeReasoner):
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


# -- structured read capability chaining ------------------------------------


async def test_read_chains_resolver_then_scoped_read() -> None:
    # The read planner resolves a name to an id via a *.search capability, then
    # uses it for the scoped report — both dispatched through the gateway and
    # re-gated (Layer B) before each call.
    cap = FakeCapabilityClient(
        results={
            "customers.search": CapabilityResult(
                summary="1 match", data=[{"id": "cust-1", "name": "Acme"}]
            ),
            "sales.report.customer": CapabilityResult(
                summary="report", data={"total": 42}
            ),
        }
    )
    reasoner = FakeReasoner(
        queries=[
            read_capability("customers.search", search="Acme"),
            read_capability("sales.report.customer", customerId="cust-1"),
        ],
        answer="Acme bought 42.",
    )
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=cap,
        authorize=_allow_all,
        sql_enabled=False,
    )
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    assert result.answer == "Acme bought 42."
    assert [c[0] for c in cap.calls] == ["customers.search", "sales.report.customer"]
    # Read idempotency keys use the agent-read: prefix.
    assert all(key.startswith("agent-read:") for _, key in cap.calls)
    # Only the entitled structured reads were offered (SQL disabled).
    assert reasoner.seen_sql_enabled == [False, False]


async def test_read_dispatch_re_gates_layer_b_before_calling_gateway() -> None:
    # Defense in depth: even if a capability reaches dispatch, it is authorized
    # again before the gateway is touched. A deny is recorded as an errored read
    # attempt and never reaches the client.
    from at_sql_analyser.harness.graph import _dispatch_read
    from at_sql_analyser.harness.state import CapabilityCall

    cap = FakeCapabilityClient()
    attempt = await _dispatch_read(
        call=CapabilityCall(capability_id="customers.search", tool_input={"search": "x"}),
        authorize=lambda _c: (False, "missing_permission"),
        capability_client=cap,
        run_id="run-1",
        index=0,
        emit=lambda _t, _p: None,
    )
    assert cap.calls == []  # denied before dispatch
    assert attempt.source == "capability"
    assert attempt.capability_id == "customers.search"
    assert attempt.error == "denied:missing_permission"


async def test_planner_does_not_offer_unentitled_read() -> None:
    # Layer A: a capability the run is not entitled to is not in the planner's
    # menu, so picking it is ignored and never dispatched.
    cap = FakeCapabilityClient()
    reasoner = FakeReasoner(
        queries=[read_capability("customers.search", search="Acme")],
        answer="could not look up",
    )
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=cap,
        authorize=lambda c: (c == "sales.get", "allowed"),
        sql_enabled=False,
    )
    result = await run_task(_task(), deps)
    assert cap.calls == []  # not entitled -> never dispatched
    assert result.query_count == 0


async def test_read_planner_only_sees_entitled_reads() -> None:
    # Layer A: the planner's authorized-reads menu is the entitled subset only.
    cap = FakeCapabilityClient()

    def only_sales_get(capability_id: str) -> tuple[bool, str]:
        return (capability_id == "sales.get"), "allowed"

    reasoner = FakeReasoner(queries=[], answer="done")
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=cap,
        authorize=only_sales_get,
        sql_enabled=False,
    )
    await run_task(_task(), deps)
    assert reasoner.seen_authorized_reads
    assert reasoner.seen_authorized_reads[0] == ("sales.get",)
