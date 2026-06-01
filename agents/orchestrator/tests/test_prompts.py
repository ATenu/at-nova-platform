"""Prompt and tool-wiring tests for the orchestrator reasoner."""

from __future__ import annotations

from nova_orchestrator.capability_guide import FINISH_TOOL_NAME, tool_name_for
from nova_orchestrator.dag import Observation
from nova_orchestrator.graph import _build_menu
from nova_orchestrator.llm import parse_tool_decision, tools_for_menu
from nova_orchestrator.prompts import (
    REASON_SYSTEM,
    compose_user,
    reason_user,
    render_menu,
    render_observations,
)

# Allowlist that surfaces the read umbrella: the umbrella + an underlying entitled
# read cap so the pure-delegator menu actually lists it.
_READ_ALLOWLIST = frozenset({"data.analyse.read", "data.query.select"})
# ...and the write umbrella, backed by an entitled write capability.
_WRITE_ALLOWLIST = frozenset({"data.act.write", "sales.create"})


def test_menu_renders_only_umbrella_delegation_skills() -> None:
    menu = _build_menu(_READ_ALLOWLIST | _WRITE_ALLOWLIST)
    text = render_menu(menu)
    # Only the two umbrella skills appear; concrete (delegated) caps never do.
    assert "data__analyse__read" in text
    assert "data__act__write" in text
    assert "actions__next" not in text
    assert "customers__search" not in text
    assert "When:" in text


def test_first_turn_prompt_mandates_tool_use() -> None:
    menu = _build_menu(_READ_ALLOWLIST)
    user = reason_user(prompt="how many customers?", menu=menu, observations=[])
    assert "MUST call exactly one tool" in user
    assert "data__analyse__read" in user


def test_tools_for_menu_finish_toggle() -> None:
    menu = _build_menu(_READ_ALLOWLIST)
    without_finish = tools_for_menu(menu, include_finish=False)
    names = {t["function"]["name"] for t in without_finish}
    assert tool_name_for("data.analyse.read") in names
    assert FINISH_TOOL_NAME not in names

    with_finish = tools_for_menu(menu, include_finish=True)
    with_names = {t["function"]["name"] for t in with_finish}
    assert FINISH_TOOL_NAME in with_names


def test_parse_tool_decision_maps_data_analyst_agent() -> None:
    menu = _build_menu(_READ_ALLOWLIST)
    tool_name = tool_name_for("data.analyse.read")
    decision = parse_tool_decision(
        [{"name": tool_name, "args": {}, "id": "1", "type": "tool_call"}],
        menu,
    )
    assert decision.action == "agent"
    assert decision.capability_id == "data.analyse.read"


def test_parse_finish_tool() -> None:
    menu = _build_menu(_READ_ALLOWLIST)
    decision = parse_tool_decision(
        [{"name": FINISH_TOOL_NAME, "args": {"note": "done"}, "id": "1", "type": "tool_call"}],
        menu,
    )
    assert decision.action == "finish"
    assert decision.note == "done"


def test_reason_system_documents_pure_delegation_policy() -> None:
    # The router prompt must describe itself as a pure delegator routing only to
    # the two umbrella skills, and must NOT mention concrete resolver tools (the
    # agent owns id resolution now).
    assert "PURE DELEGATOR" in REASON_SYSTEM
    assert "data__analyse__read" in REASON_SYSTEM
    assert "data__act__write" in REASON_SYSTEM
    assert "customers__search" not in REASON_SYSTEM
    assert "actions__list" not in REASON_SYSTEM


def test_observations_carry_structured_data_for_grounding() -> None:
    # Regression: the composer must see the actual rows, not just the count
    # summary, so a count-only summary can still be grounded in the data payload.
    obs = Observation(
        capability_id="sop.read",
        kind="tool",
        status="completed",
        summary="3 SOP(s) available.",
        data={
            "sops": [
                {"id": "s-1", "name": "Refund of purchase", "description": "7-day window"},
            ],
            "total": 3,
        },
    )
    rendered = render_observations([obs])
    assert "sop.read -> completed: 3 SOP(s) available." in rendered
    assert "data:" in rendered
    # The grounded facts the summary omitted are now present for the model.
    assert "Refund of purchase" in rendered
    assert "7-day window" in rendered
    # The composer prompt embeds the same grounded observations.
    composed = compose_user(prompt="what SOPs exist?", observations=[obs])
    assert "Refund of purchase" in composed


def test_failed_observation_renders_reason_without_data_line() -> None:
    obs = Observation(
        capability_id="issues.list",
        kind="tool",
        status="failed",
        reason="tool_gateway_error:403",
        data=None,
    )
    rendered = render_observations([obs])
    assert "issues.list -> failed: tool_gateway_error:403" in rendered
    assert "data:" not in rendered
