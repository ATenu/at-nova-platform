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
from nova_orchestrator.agents import AgentDescriptor, AgentRegistry
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
    _load_history,
    _missing_required,
    _record_turn,
    _route_for_capability,
)
from nova_orchestrator.llm import ReasonDecision

from .fakes import FakeReasoner
from .test_agent_state import _FakeRedis


def _registry() -> AgentRegistry:
    sql_analyst = AgentDescriptor(
        name="at-sql-analyser",
        receiver="at-sql-analyser",
        base_url="http://agent",
        audience_scope="nova-agent-at-sql-analyser",
        skills=frozenset({"data.analyse.read", "data.act.write"}),
    )
    return AgentRegistry((sql_analyst,))


def test_menu_is_layer_a_only_and_drops_unknown_ids() -> None:
    # Layer A: the menu is built ONLY from the verified snapshot's allowlist; an id
    # not present in the catalog is silently dropped (default deny).
    allowlist = frozenset({"data.analyse.read", "sales.report.customer", "not.a.capability"})
    menu = _build_menu(allowlist)
    ids = {item.capability_id for item in menu}
    assert ids == {"data.analyse.read", "sales.report.customer"}


def test_menu_excludes_mcp_tool_capabilities() -> None:
    # mcp-tool capabilities are the data agents' own internal tools (DB MCP
    # server) and are not orchestrator-dispatchable, so they never appear.
    menu = _build_menu(frozenset({"data.query.select", "data.schema.describe", "actions.next"}))
    ids = {item.capability_id for item in menu}
    assert ids == {"actions.next"}


def test_empty_allowlist_yields_empty_menu() -> None:
    assert _build_menu(frozenset()) == ()


def test_routing_uses_agent_only_when_an_agent_is_registered() -> None:
    registry = _registry()
    # Registered A2A skill -> agent path.
    assert _route_for_capability("data.analyse.read", registry) == "agent"
    # agent-skill capability with NO registered agent is executed by the Node
    # tool gateway's CapabilityExecutor -> tool path (previously mis-routed).
    assert _route_for_capability("sales.report.customer", registry) == "tool"
    assert _route_for_capability("issues.create", registry) == "tool"
    # Without a registry, everything routes to the tool gateway (fail safe).
    assert _route_for_capability("data.analyse.read", None) == "tool"


def test_new_capabilities_route_to_the_node_tool_gateway() -> None:
    # No A2A agent implements these, so they are executed by the Node
    # CapabilityExecutor (tool path), re-gated by Layer B regardless.
    registry = _registry()
    for capability_id in [
        "customers.search",
        "customers.get",
        "products.search",
        "sales.list",
        "issues.update",
        "actions.addComment",
        "sop.addVersion",
    ]:
        assert _route_for_capability(capability_id, registry) == "tool"


def test_resolver_then_scoped_chaining_is_expressible_in_the_menu() -> None:
    # The conversational flow needs BOTH the resolver (no required id) and the
    # scoped tool (requires the id) in the menu so the reasoner can chain them.
    menu = _build_menu(frozenset({"customers.search", "customers.get"}))
    by_id = {item.capability_id: item for item in menu}
    assert by_id["customers.search"].resource_scoped is False
    assert by_id["customers.get"].resource_scoped is True
    # The scoped tool declares its required id; the resolver does not.
    assert _missing_required(_TOOL_SPECS["customers.get"], {}) == ["customerId"]
    assert _missing_required(_TOOL_SPECS["customers.search"], {}) == []


def test_every_agent_skill_capability_has_a_curated_tool_spec() -> None:
    # Generalization drift guard: each user-selectable (agent-skill) capability
    # must ship a hand-written tool description so the reasoner can pick it
    # reliably. New capabilities fail this until documented.
    missing = [
        capability.id
        for capability in CAPABILITY_CATALOG
        if capability.kind == "agent-skill" and capability.id not in _TOOL_SPECS
    ]
    assert missing == []


def test_missing_required_detects_absent_keys() -> None:
    from nova_orchestrator.capability_guide import spec_for

    spec = spec_for("sales.report.customer")
    assert _missing_required(spec, {}) == ["customerId"]
    assert _missing_required(spec, {"customerId": "u-1"}) == []


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
    menu = _build_menu(frozenset({"data.analyse.read"}))
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
