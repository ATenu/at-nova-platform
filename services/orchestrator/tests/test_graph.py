"""Orchestration graph decision logic (Layer A menu, routing, observation flow).

These replace the old deterministic planner/steering tests: the model now
chooses the next step, but ONLY from the Layer A menu, and code (not the model)
decides routing and terminal handling. The transactional Layer B dispatch is
covered by ``test_policy_gate`` (the authoritative gate) and the agent client by
``test_agent_client``.
"""

from __future__ import annotations

from nova_orchestrator.dag import Observation
from nova_orchestrator.graph import (
    StepResult,
    _after_dispatch,
    _build_menu,
    _fallback_answer,
    _route_for_capability,
    _safe_event_payload,
)
from nova_orchestrator.llm import ReasonDecision

from .fakes import FakeReasoner


def test_menu_is_layer_a_only_and_drops_unknown_ids() -> None:
    # Layer A: the menu is built ONLY from the verified snapshot's allowlist, and
    # an id not present in the catalog is silently dropped (default deny).
    allowlist = frozenset({"data.analyse.read", "data.query.select", "not.a.capability"})
    menu = _build_menu(allowlist)
    ids = {item.capability_id for item in menu}
    assert ids == {"data.analyse.read", "data.query.select"}


def test_empty_allowlist_yields_empty_menu() -> None:
    assert _build_menu(frozenset()) == ()


def test_routing_sends_agent_skills_to_agent_and_tools_to_gateway() -> None:
    assert _route_for_capability("data.analyse.read") == "agent"
    assert _route_for_capability("data.query.select") == "tool"
    # An unknown id is never an agent skill; it routes to the tool gateway where
    # Layer B denies it as an unknown capability.
    assert _route_for_capability("not.a.capability") == "tool"


def test_after_dispatch_terminal_status_ends_run() -> None:
    out = _after_dispatch(StepResult(None, terminal_status="canceled"))
    assert out["route"] == "end"
    assert out["status"] == "canceled"
    assert out["canceled"] is True


def test_after_dispatch_observation_continues_to_critique() -> None:
    obs = Observation("data.query.select", "tool", "completed", summary="ok")
    out = _after_dispatch(StepResult(obs))
    assert out["route"] == "critique"
    assert out["observations"] == [obs]


def test_fallback_answer_distinguishes_progress_from_none() -> None:
    completed = [Observation("x", "tool", "completed")]
    assert _fallback_answer(completed) == "Completed the requested actions."
    denied = [Observation("x", "tool", "denied", reason="missing_permission")]
    assert "could not map your request" in _fallback_answer(denied)


def test_safe_event_payload_keeps_only_primitives() -> None:
    out = _safe_event_payload(
        {"rowCount": 12, "ok": True, "ratio": 1.5, "note": "hi", "rows": [1, 2], "obj": {"a": 1}}
    )
    assert out == {"rowCount": 12, "ok": True, "ratio": 1.5, "note": "hi"}


def test_reasoner_only_ever_sees_the_layer_a_menu() -> None:
    # A FakeReasoner records the menu it is shown; assert it is the entitled set.
    reasoner = FakeReasoner(
        decisions=[ReasonDecision(action="tool", capability_id="data.query.select")]
    )
    menu = _build_menu(frozenset({"data.query.select"}))
    decision = reasoner.reason(prompt="p", menu=menu, observations=[])
    assert reasoner.seen_menus == [("data.query.select",)]
    assert decision.capability_id == "data.query.select"


def test_reasoner_finishes_when_decisions_exhausted() -> None:
    reasoner = FakeReasoner(decisions=[])
    decision = reasoner.reason(prompt="p", menu=(), observations=[])
    assert decision.action == "finish"
