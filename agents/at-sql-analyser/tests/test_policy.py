from __future__ import annotations

from at_sql_analyser.auth.policy import authorize, is_entitled
from at_sql_analyser.authz.rbac_registry import (
    CapabilityDescriptor,
    RbacRegistry,
    set_active_registry,
)

from .fakes import make_snapshot


def test_allows_read_skill_for_entitled_roles() -> None:
    snap = make_snapshot(roles=("ops-compliance",), allowlist=("data.analyse.read",))
    decision = authorize(snap, "data.analyse.read")
    assert decision.allowed
    assert is_entitled(snap, "data.analyse.read")


def test_denies_when_not_in_allowlist() -> None:
    snap = make_snapshot(roles=("ops-compliance",), allowlist=())
    decision = authorize(snap, "data.analyse.read")
    assert not decision.allowed
    assert decision.reason == "not_in_allowlist"


def test_read_umbrella_is_a_broad_entry_point() -> None:
    # The umbrella is gated only on the universal create-agent-run permission, so
    # any agent-using role may invoke it; real authorization is per concrete cap.
    snap = make_snapshot(roles=("sales-user",), allowlist=("data.analyse.read",))
    decision = authorize(snap, "data.analyse.read")
    assert decision.allowed


def test_denies_concrete_read_when_roles_lack_permission() -> None:
    # Authorization is enforced per concrete capability: ops-compliance lacks
    # read-customers, so the structured customer read is denied (Layer B).
    snap = make_snapshot(roles=("ops-compliance",), allowlist=("customers.search",))
    decision = authorize(snap, "customers.search")
    assert not decision.allowed
    assert decision.reason == "missing_permission"


def test_write_allowed_without_approval_by_default() -> None:
    # Permission consent alone authorizes the write: approval is opt-in (default
    # false) and decoupled from risk, so an entitled user is not blocked.
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write",))
    decision = authorize(snap, "data.act.write")
    assert decision.allowed
    assert decision.reason == "allowed"


def test_approval_required_only_when_capability_opts_in() -> None:
    # When an admin flags a capability ``requires_approval``, the gate denies
    # until a recorded approval is supplied — independent of risk level.
    gated = CapabilityDescriptor(
        id="data.act.write",
        kind="agent-skill",
        mode="write",
        required_permissions=("create-agent-run",),
        risk="low",
        resource_scoped=True,
        delegated=False,
        enabled=True,
        requires_approval=True,
    )
    set_active_registry(
        RbacRegistry(
            revision=1,
            capabilities=(gated,),
            role_permissions={"admin": ("create-agent-run",)},
        )
    )
    snap = make_snapshot(
        roles=("admin",),
        allowlist=("data.act.write",),
        permissions=frozenset({"create-agent-run"}),
    )
    without = authorize(snap, "data.act.write")
    assert not without.allowed
    assert without.reason == "approval_required"
    with_approval = authorize(snap, "data.act.write", has_approval=True)
    assert with_approval.allowed


def test_unknown_capability_denied() -> None:
    snap = make_snapshot(allowlist=("data.unknown",))
    decision = authorize(snap, "data.unknown")
    assert not decision.allowed
    assert decision.reason == "unknown_capability"
