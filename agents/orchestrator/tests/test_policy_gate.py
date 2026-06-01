"""Layer B policy-gate behavior (default deny, prompt-injection resistant)."""

from __future__ import annotations

from nova_orchestrator.authz.policy_gate import (
    REASON_ALLOWED,
    REASON_MISSING_PERMISSION,
    REASON_UNKNOWN_CAPABILITY,
    evaluate_capability,
)


def test_allows_capability_when_roles_grant_all_required_permissions() -> None:
    decision = evaluate_capability("sales.report.customer", roles=["sales-user"])
    assert decision.allowed is True
    assert decision.reason == REASON_ALLOWED


def test_denies_when_a_required_permission_is_missing() -> None:
    # ops-compliance has only SOP permissions, not read-sales/read-customers.
    decision = evaluate_capability("sales.report.customer", roles=["ops-compliance"])
    assert decision.allowed is False
    assert decision.reason == REASON_MISSING_PERMISSION
    assert decision.missing_permission in {"read-sales", "read-customers"}


def test_denies_unknown_capability() -> None:
    decision = evaluate_capability("tool.delete.everything", roles=["admin"])
    assert decision.allowed is False
    assert decision.reason == REASON_UNKNOWN_CAPABILITY


def test_denies_write_capability_for_read_only_role() -> None:
    # customer-support cannot write sales.
    decision = evaluate_capability("sales.create", roles=["customer-support"])
    assert decision.allowed is False
    assert decision.reason == REASON_MISSING_PERMISSION
    assert decision.missing_permission == "write-sales"


def test_empty_roles_deny_everything() -> None:
    assert evaluate_capability("sales.report.customer", roles=[]).allowed is False
    assert evaluate_capability("sop.read", roles=[]).allowed is False
