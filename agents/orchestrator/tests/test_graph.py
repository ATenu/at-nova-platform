"""Orchestration graph decision logic (Layer A menu, routing, observation flow).

These replace the old deterministic planner/steering tests: the model now
chooses the next step, but ONLY from the Layer A menu, and code (not the model)
decides routing and terminal handling. The transactional Layer B dispatch is
covered by ``test_policy_gate`` (the authoritative gate) and the agent client by
``test_agent_client``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from nova_orchestrator.agent_state import AgentStateStore, HistoryEntry
from nova_orchestrator.agents import AgentDescriptor, AgentRegistry, CardSkill
from nova_orchestrator.authz.nova_authz import CAPABILITY_CATALOG
from nova_orchestrator.authz.snapshot import EntitlementSnapshot
from nova_orchestrator.capability_guide import _TOOL_SPECS
from nova_orchestrator.dag import Observation
from nova_orchestrator.graph import (
    OrchestratorDeps,
    StepResult,
    _after_dispatch,
    _build_menu,
    _call_signature,
    _fallback_answer,
    _has_entitled_underlying,
    _load_history,
    _missing_required,
    _record_turn,
)
from nova_orchestrator.llm import ReasonDecision

from .fakes import FakeReasoner
from .test_agent_state import _FakeRedis


def test_menu_collapses_to_umbrellas_and_hides_delegated_caps() -> None:
    # The orchestrator is a pure delegator: concrete (delegated) business caps and
    # unknown ids are never on the menu; only the umbrella delegation skills are,
    # and only when the user is entitled to an underlying cap of that mode.
    allowlist = frozenset(
        {
            "data.analyse.read",
            "data.act.write",
            "sales.report.customer",  # delegated read -> hidden, enables read umbrella
            "sales.create",  # delegated write -> hidden, enables write umbrella
            "not.a.capability",
        }
    )
    menu = _build_menu(allowlist)
    ids = {item.capability_id for item in menu}
    assert ids == {"data.analyse.read", "data.act.write"}


def test_menu_excludes_mcp_tool_and_delegated_capabilities() -> None:
    # mcp-tool caps (DB MCP server) and delegated business caps are agent-internal
    # and never appear; with no entitled underlying cap, no umbrella shows either.
    menu = _build_menu(frozenset({"data.query.select", "data.schema.describe", "actions.next"}))
    assert menu == ()


def test_read_umbrella_shown_when_read_data_present() -> None:
    # read-data (the SQL mcp-tools) is itself enough underlying entitlement to
    # surface the read umbrella, even without any structured read cap.
    menu = _build_menu(frozenset({"data.analyse.read", "data.query.select"}))
    ids = {item.capability_id for item in menu}
    assert ids == {"data.analyse.read"}


def test_write_umbrella_hidden_without_entitled_write() -> None:
    # The umbrella is present in the allowlist (create-agent-run) but is hidden
    # when the user has no underlying entitled write capability (Layer A stays
    # meaningful).
    menu = _build_menu(frozenset({"data.act.write", "sales.report.customer"}))
    ids = {item.capability_id for item in menu}
    assert "data.act.write" not in ids


def test_has_entitled_underlying_read_and_write() -> None:
    read_only = frozenset({"sales.report.customer"})
    assert _has_entitled_underlying(read_only, "read") is True
    assert _has_entitled_underlying(read_only, "write") is False
    write_only = frozenset({"sales.create"})
    assert _has_entitled_underlying(write_only, "write") is True
    assert _has_entitled_underlying(write_only, "read") is False


def test_empty_allowlist_yields_empty_menu() -> None:
    assert _build_menu(frozenset()) == ()


def _registry_with_card(description: str, tags: tuple[str, ...]) -> AgentRegistry:
    agent = AgentDescriptor(
        name="at-sql-analyser",
        receiver="at-sql-analyser",
        base_url="http://agent",
        audience_scope="nova-agent-sql-analyst",
        skills=frozenset({"data.analyse.read"}),
        skill_cards=(
            CardSkill(
                id="data.analyse.read", name="Analyse", description=description, tags=tags
            ),
        ),
    )
    return AgentRegistry((agent,))


# Allowlist that surfaces the read umbrella: the umbrella itself + an underlying
# entitled read cap (read-data) so ``_has_entitled_underlying`` is satisfied.
_READ_ALLOWLIST = frozenset({"data.analyse.read", "data.query.select"})


def test_menu_uses_card_text_for_agent_skill() -> None:
    # The Agent Card is the source of truth for an umbrella's menu text:
    # updating the card (not the orchestrator) changes how it is advertised.
    registry = _registry_with_card("Answer ad-hoc data questions.", ("count", "trend"))
    menu = _build_menu(_READ_ALLOWLIST, registry)
    item = next(i for i in menu if i.capability_id == "data.analyse.read")
    assert item.summary == "Answer ad-hoc data questions."
    assert "count" in item.when_to_use and "trend" in item.when_to_use


def test_menu_falls_back_to_guide_when_card_absent() -> None:
    # Static seed path (or any agent that registered no card description): the
    # curated guide remains the fallback so the menu text is never empty.
    agent = AgentDescriptor(
        name="at-sql-analyser",
        receiver="at-sql-analyser",
        base_url="http://agent",
        audience_scope="nova-agent-sql-analyst",
        skills=frozenset({"data.analyse.read"}),
    )
    registry = AgentRegistry((agent,))
    menu = _build_menu(_READ_ALLOWLIST, registry)
    item = next(i for i in menu if i.capability_id == "data.analyse.read")
    assert item.summary == _TOOL_SPECS["data.analyse.read"].summary


def test_tools_for_menu_description_uses_menu_item_text() -> None:
    from nova_orchestrator.dag import MenuItem
    from nova_orchestrator.llm import tools_for_menu

    item = MenuItem(
        capability_id="data.analyse.read",
        kind="agent-skill",
        mode="read",
        resource_scoped=False,
        tool_name="data__analyse__read",
        summary="CARD SUMMARY",
        when_to_use="CARD WHEN",
        input_fields=(),
    )
    tools = tools_for_menu([item], include_finish=False)
    description = tools[0]["function"]["description"]
    assert "CARD SUMMARY" in description
    assert "CARD WHEN" in description


def test_only_umbrella_skills_have_a_curated_tool_spec() -> None:
    # Pure-delegator drift guard: the orchestrator only surfaces the umbrella
    # (non-delegated) agent-skills, so EXACTLY those must ship a curated spec.
    # Concrete (delegated) business caps are agent-internal and intentionally
    # undocumented here (their inputs live with the agent + Node gateway).
    umbrellas = {
        capability.id
        for capability in CAPABILITY_CATALOG
        if capability.kind == "agent-skill" and not capability.delegated
    }
    assert set(_TOOL_SPECS) == umbrellas
    # Delegated caps must NOT be documented on the orchestrator side.
    delegated = {c.id for c in CAPABILITY_CATALOG if c.delegated}
    assert not (delegated & set(_TOOL_SPECS))


def test_umbrella_specs_declare_no_required_inputs() -> None:
    # The orchestrator delegates the whole goal (the prompt) to the agent, so an
    # umbrella never has required inputs the model must populate — dispatch is
    # never blocked by ``_missing_required``.
    from nova_orchestrator.capability_guide import spec_for

    for umbrella in ("data.analyse.read", "data.act.write"):
        assert _missing_required(spec_for(umbrella), {}) == []


def test_call_signature_is_order_independent() -> None:
    a = _call_signature("sales.report.customer", {"customerId": "u-1", "x": 1})
    b = _call_signature("sales.report.customer", {"x": 1, "customerId": "u-1"})
    assert a == b
    assert a != _call_signature("sales.report.customer", {"customerId": "u-2"})


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


def test_reasoner_only_ever_sees_the_layer_a_menu() -> None:
    menu = _build_menu(_READ_ALLOWLIST)
    reasoner = FakeReasoner(
        decisions=[ReasonDecision(action="agent", capability_id="data.analyse.read")]
    )
    decision = reasoner.reason(prompt="p", menu=menu, observations=[])
    assert reasoner.seen_menus == [("data.analyse.read",)]
    assert decision.capability_id == "data.analyse.read"


def test_reasoner_finishes_when_decisions_exhausted() -> None:
    reasoner = FakeReasoner(decisions=[])
    decision = reasoner.reason(prompt="p", menu=(), observations=[])
    assert decision.action == "finish"


def _entitlement(allowlist: set[str]) -> EntitlementSnapshot:
    now = datetime.now(UTC)
    return EntitlementSnapshot(
        owner_subject="user-1",
        owner_user_id="00000000-0000-0000-0000-000000000001",
        roles=("sales_rep",),
        permissions=frozenset({"data:read"}),
        capability_allowlist=frozenset(allowlist),
        snapshot_hash="sha256:x",
        issued_at=now,
        expires_at=now + timedelta(hours=1),
    )


def _deps(store: AgentStateStore | None, snapshot: EntitlementSnapshot) -> OrchestratorDeps:
    return OrchestratorDeps(
        reasoner=FakeReasoner(),
        session_factory=None,  # not exercised by the history helpers
        run_id="run-1",
        snapshot=snapshot,
        gateway=None,  # not exercised by the history helpers
        max_steps=8,
        state_store=store,
        history_read_limit=20,
    )


def test_load_history_renders_prior_turns() -> None:
    store = AgentStateStore(owner_subject="user-1", client=_FakeRedis())
    store.append_history("conv-1", HistoryEntry(role="user", content="how many customers?"))
    store.append_history("conv-1", HistoryEntry(role="assistant", content="128"))
    rendered = _load_history(_deps(store, _entitlement({"data.analyse.read"})), "conv-1")
    assert "how many customers?" in rendered
    assert "128" in rendered


def test_load_history_is_empty_without_store_or_conversation() -> None:
    assert _load_history(_deps(None, _entitlement(set())), "conv-1") == ""
    store = AgentStateStore(owner_subject="user-1", client=_FakeRedis())
    assert _load_history(_deps(store, _entitlement(set())), "") == ""


def test_record_turn_stores_full_unredacted_content_for_entitled_owner() -> None:
    store = AgentStateStore(owner_subject="user-1", client=_FakeRedis())
    deps = _deps(store, _entitlement({"data.analyse.read"}))
    observations = [
        Observation(
            "data.analyse.read",
            "agent",
            "completed",
            summary="Top customer: Jane Doe (jane@example.com)",
        )
    ]
    _record_turn(
        deps,
        conversation_id="conv-1",
        prompt="who is my top customer?",
        answer="Your top customer is Jane Doe (jane@example.com).",
        observations=observations,
    )
    history = store.read_history("conv-1")
    assert [e.role for e in history] == ["user", "assistant"]
    # PII (the email) is preserved verbatim because the owner is entitled to it.
    assert "jane@example.com" in history[1].content
    section = store.read_section("run-1", "orchestrator")
    assert section is not None
    assert section["observations"][0]["capability"] == "data.analyse.read"


def test_record_turn_is_noop_without_store_or_conversation() -> None:
    # No store configured: nothing is persisted and no error is raised.
    _record_turn(
        _deps(None, _entitlement(set())),
        conversation_id="conv-1",
        prompt="hi",
        answer="hello",
        observations=[],
    )
    store = AgentStateStore(owner_subject="user-1", client=_FakeRedis())
    _record_turn(
        _deps(store, _entitlement(set())),
        conversation_id="",
        prompt="hi",
        answer="hello",
        observations=[],
    )
    assert store.read_history("conv-1") == []
