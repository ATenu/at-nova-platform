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


async def test_no_actions_completes_gracefully() -> None:
    result = await run_task(_task(), _deps(writes=[], authorize=_allow_all))
    assert result.status == "completed"
    assert result.answer == "No actions were required."


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


async def test_write_events_are_pii_free() -> None:
    seen: list[tuple[str, dict[str, object]]] = []
    deps = _deps(
        writes=[WriteItem(capability_id="issues.create", input={"title": "secret"})],
        authorize=_allow_all,
        on_event=lambda t, p: seen.append((t, p)),
    )
    await run_task(_task(), deps)
    types = [t for t, _ in seen]
    assert "agent.write.started" in types
    assert "agent.write.completed" in types
    for _, payload in seen:
        assert "title" not in payload
        assert "input" not in payload
