"""Write-path graph tests: per-action Layer B gate + capability dispatch.

The reasoner only *proposes* write capabilities; ``dispatch_writes`` re-checks
each one against the authorizer (Layer B) before invoking the gateway, and never
dispatches a denied capability."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from at_sql_analyser.harness.graph import GraphDeps, run_task
from at_sql_analyser.harness.guards import GuardLimits
from at_sql_analyser.harness.llm import WriteItem
from at_sql_analyser.harness.state import TaskInput
from at_sql_analyser.observability.tracing import scrub
from at_sql_analyser.tools.capability_client import CapabilityResult

from .fakes import FakeCapabilityClient, FakeReasoner

Authorize = Callable[[str], tuple[bool, str]]
EventSink = Callable[[str, dict[str, Any]], None]

LIMITS = GuardLimits(max_iterations=5, max_queries=5, total_timeout_s=30.0)


def _task() -> TaskInput:
    return TaskInput(
        run_id="run-1",
        correlation_id="c",
        skill_id="data.act.write",
        goal="create an issue",
        intent="write",
    )


def _allow_all(_capability_id: str) -> tuple[bool, str]:
    return True, "allowed"


def _deny_all(_capability_id: str) -> tuple[bool, str]:
    return False, "missing_permission"


def _deps(
    *,
    writes: list[WriteItem],
    authorize: Authorize,
    client: FakeCapabilityClient | None = None,
    on_event: EventSink | None = None,
) -> GraphDeps:
    return GraphDeps(
        reasoner=FakeReasoner(writes=writes),
        limits=LIMITS,
        capability_client=client or FakeCapabilityClient(),
        authorize=authorize,
        on_event=on_event or (lambda _t, _p: None),
    )


async def test_dispatches_entitled_write_with_idempotency_key() -> None:
    client = FakeCapabilityClient()
    deps = _deps(
        writes=[WriteItem(capability_id="issues.create", input={"title": "x"})],
        authorize=_allow_all,
        client=client,
    )
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    assert client.calls == [("issues.create", "agent-write:run-1:issues.create:0")]


async def test_per_action_denial_blocks_dispatch() -> None:
    client = FakeCapabilityClient()
    deps = _deps(
        writes=[WriteItem(capability_id="issues.create", input={})],
        authorize=_deny_all,
        client=client,
    )
    result = await run_task(_task(), deps)
    assert result.status == "failed"
    assert result.reason == "missing_permission"
    assert client.calls == []  # never dispatched a denied capability


async def test_no_entitled_writes_completes_without_dispatch() -> None:
    """When RBAC grants no concrete write capabilities, nothing is dispatched."""

    def _reads_only(capability_id: str) -> tuple[bool, str]:
        from at_sql_analyser.authz.registry import get_capability

        cap = get_capability(capability_id)
        if cap is not None and cap.mode == "write" and cap.delegated:
            return False, "missing_permission"
        return True, "allowed"

    result = await run_task(_task(), _deps(writes=[], authorize=_reads_only))
    assert result.status == "completed"
    assert result.answer == "No actions were required."


async def test_planner_finish_with_entitled_writes_fails_closed() -> None:
    """Entitled writes exist but the planner never emits one → fail, not a no-op success."""
    result = await run_task(_task(), _deps(writes=[], authorize=_allow_all))
    assert result.status == "failed"
    assert result.reason in {
        "iteration_budget_exhausted",
        "query_budget_exhausted",
        "no_progress",
        "no_write_executed",
    }


async def test_gateway_error_fails_closed() -> None:
    client = FakeCapabilityClient(error_caps={"issues.create"})
    deps = _deps(
        writes=[WriteItem(capability_id="issues.create", input={})],
        authorize=_allow_all,
        client=client,
    )
    result = await run_task(_task(), deps)
    assert result.status == "failed"
    assert result.reason == "capability_error:403"


async def test_mixed_results_complete_when_any_succeeds() -> None:
    client = FakeCapabilityClient(error_caps={"sales.create"})
    deps = _deps(
        writes=[
            WriteItem(capability_id="issues.create", input={}),
            WriteItem(capability_id="sales.create", input={}),
        ],
        authorize=_allow_all,
        client=client,
    )
    result = await run_task(_task(), deps)
    assert result.status == "completed"


async def test_write_resolves_missing_id_via_read_then_dispatches() -> None:
    # The request names the target by title (no id). The planner first RESOLVES
    # the id with an entitled read capability, then dispatches the write — the
    # resolve read runs before the write, and both are audited.
    seen: list[str] = []
    cap = FakeCapabilityClient(
        results={
            "actions.list": CapabilityResult(
                summary="1 action",
                data={"items": [{"id": "act-123", "title": "Arrange maintenance slot"}]},
            )
        }
    )
    reasoner = FakeReasoner(
        resolve_reads=[("actions.list", {})],
        writes=[
            WriteItem(
                capability_id="actions.addComment",
                input={"actionId": "act-123", "comment": "Following up."},
            )
        ],
    )
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=cap,
        authorize=_allow_all,
        on_event=lambda t, _p: seen.append(t),
    )
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    # The resolving read was dispatched first, then the write.
    assert [capability_id for capability_id, _ in cap.calls] == [
        "actions.list",
        "actions.addComment",
    ]
    assert "agent.read.completed" in seen
    assert "agent.write.completed" in seen


async def test_write_resolution_is_bounded_and_fails_closed() -> None:
    # A planner that keeps asking to resolve (never finishing) must be stopped by
    # the guards without ever dispatching an under-specified write.
    cap = FakeCapabilityClient()
    reasoner = FakeReasoner(
        resolve_reads=[("actions.list", {})] * 50,  # never reaches the write
        writes=[WriteItem(capability_id="actions.addComment", input={})],
    )
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=cap,
        authorize=_allow_all,
        on_event=lambda _t, _p: None,
    )
    result = await run_task(_task(), deps)
    # No write dispatched; the loop terminated on a guard and failed closed.
    assert all(capability_id == "actions.list" for capability_id, _ in cap.calls)
    assert "actions.addComment" not in [capability_id for capability_id, _ in cap.calls]
    assert result.status == "failed"


async def test_write_planner_receives_conversation_history() -> None:
    # Multi-turn references (e.g. "do the same") can only be resolved on the write
    # path if the orchestrator-aligned prior-turn context reaches the write planner,
    # exactly as it already does for the read planner.
    reasoner = FakeReasoner(
        writes=[WriteItem(capability_id="issues.create", input={"title": "x"})]
    )
    deps = GraphDeps(
        reasoner=reasoner,
        limits=LIMITS,
        capability_client=FakeCapabilityClient(),
        authorize=_allow_all,
        on_event=lambda _t, _p: None,
        conversation_history="user: add a comment 'from crm that all'\nassistant: Done.",
    )
    result = await run_task(_task(), deps)
    assert result.status == "completed"
    assert reasoner.seen_conversation_history == (
        "user: add a comment 'from crm that all'\nassistant: Done."
    )


async def test_write_event_traces_stay_pii_free() -> None:
    # The owner's own stream carries the full capability input/output (so every
    # write is trackable end to end), but the SCRUBBED trace that reaches logs /
    # Langfuse must never contain the raw values: nested I/O collapses to
    # "<dict>" and forbidden keys are dropped.
    seen: list[tuple[str, dict[str, object]]] = []
    deps = _deps(
        writes=[WriteItem(capability_id="issues.create", input={"title": "secret-pii"})],
        authorize=_allow_all,
        on_event=lambda t, p: seen.append((t, p)),
    )
    await run_task(_task(), deps)
    types = [t for t, _ in seen]
    assert "agent.write.started" in types
    assert "agent.write.completed" in types

    # The verbatim event (returned to the orchestrator → owner stream) keeps the input.
    started = next(payload for event_type, payload in seen if event_type == "agent.write.started")
    assert started["input"] == {"title": "secret-pii"}

    # The trace, however, is scrubbed: the raw value never appears.
    for _, payload in seen:
        assert "secret-pii" not in str(scrub(payload))
