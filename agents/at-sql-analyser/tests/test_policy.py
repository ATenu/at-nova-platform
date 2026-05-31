from __future__ import annotations

from at_sql_analyser.auth.policy import authorize, is_entitled

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


def test_denies_when_roles_lack_permission() -> None:
    snap = make_snapshot(roles=("sales-user",), allowlist=("data.analyse.read",))
    decision = authorize(snap, "data.analyse.read")
    assert not decision.allowed
    assert decision.reason == "missing_permission"


def test_high_risk_write_requires_approval() -> None:
    snap = make_snapshot(roles=("admin",), allowlist=("data.act.write",))
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
