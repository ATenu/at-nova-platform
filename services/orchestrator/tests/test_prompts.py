"""Prompt and tool-wiring tests for the orchestrator reasoner."""

from __future__ import annotations

from nova_orchestrator.capability_guide import FINISH_TOOL_NAME, tool_name_for
from nova_orchestrator.graph import _build_menu
from nova_orchestrator.llm import parse_tool_decision, tools_for_menu
from nova_orchestrator.prompts import reason_user, render_menu


def test_menu_renders_rich_tool_catalog() -> None:
    menu = _build_menu(frozenset({"data.analyse.read", "actions.next"}))
    text = render_menu(menu)
    assert "data__analyse__read" in text
    assert "actions__next" in text
    assert "When:" in text
    assert "SQL data analyst" in text


def test_first_turn_prompt_mandates_tool_use() -> None:
    menu = _build_menu(frozenset({"data.analyse.read"}))
    user = reason_user(prompt="how many customers?", menu=menu, observations=[])
    assert "MUST call exactly one tool" in user
    assert "data__analyse__read" in user


def test_tools_for_menu_finish_toggle() -> None:
    menu = _build_menu(frozenset({"data.analyse.read"}))
    without_finish = tools_for_menu(menu, include_finish=False)
    names = {t["function"]["name"] for t in without_finish}
    assert tool_name_for("data.analyse.read") in names
    assert FINISH_TOOL_NAME not in names

    with_finish = tools_for_menu(menu, include_finish=True)
    with_names = {t["function"]["name"] for t in with_finish}
    assert FINISH_TOOL_NAME in with_names


def test_parse_tool_decision_maps_data_analyst_agent() -> None:
    menu = _build_menu(frozenset({"data.analyse.read"}))
    tool_name = tool_name_for("data.analyse.read")
    decision = parse_tool_decision(
        [{"name": tool_name, "args": {}, "id": "1", "type": "tool_call"}],
        menu,
    )
    assert decision.action == "agent"
    assert decision.capability_id == "data.analyse.read"


def test_parse_finish_tool() -> None:
    menu = _build_menu(frozenset({"data.analyse.read"}))
    decision = parse_tool_decision(
        [{"name": FINISH_TOOL_NAME, "args": {"note": "done"}, "id": "1", "type": "tool_call"}],
        menu,
    )
    assert decision.action == "finish"
    assert decision.note == "done"
