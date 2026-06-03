"""Layer B policy-gate behavior (default deny, prompt-injection resistant).

The gate now authorizes against the snapshot's effective PERMISSIONS resolved
from the dynamic registry (the seeded active policy is provided by the autouse
``conftest`` fixture), mirroring the API's ``RbacRegistry`` and the integrity-hashed
entitlement snapshot.
"""

from __future__ import annotations

from nova_orchestrator.authz.policy_gate import (
    REASON_ALLOWED,
    REASON_MISSING_PERMISSION,
    REASON_UNKNOWN_CAPABILITY,
    evaluate_capability,
)
from nova_orchestrator.authz.rbac_registry import reset_active_registry
from nova_orchestrator.authz.registry import permissions_for_roles


def _perms(*roles: str) -> set[str]:
    return permissions_for_roles(roles)


def test_allows_capability_when_permissions_grant_all_required() -> None:
    decision = evaluate_capability("sales.report.customer", _perms("sales-user"))
    assert decision.allowed is True
    assert decision.reason == REASON_ALLOWED


def test_denies_when_a_required_permission_is_missing() -> None:
    # ops-compliance has only SOP permissions, not read-sales/read-customers.
    decision = evaluate_capability("sales.report.customer", _perms("ops-compliance"))
    assert decision.allowed is False
    assert decision.reason == REASON_MISSING_PERMISSION
    assert decision.missing_permission in {"read-sales", "read-customers"}


def test_denies_unknown_capability() -> None:
    decision = evaluate_capability("tool.delete.everything", _perms("admin"))
    assert decision.allowed is False
    assert decision.reason == REASON_UNKNOWN_CAPABILITY


def test_denies_write_capability_for_read_only_role() -> None:
    # customer-support cannot write sales.
    decision = evaluate_capability("sales.create", _perms("customer-support"))
    assert decision.allowed is False
    assert decision.reason == REASON_MISSING_PERMISSION
    assert decision.missing_permission == "write-sales"


def test_empty_permissions_deny_everything() -> None:
    assert evaluate_capability("sales.report.customer", set()).allowed is False
    assert evaluate_capability("sop.read", set()).allowed is False


def test_fails_closed_when_no_registry_is_loaded() -> None:
    # Outage / startup: with no active policy, every capability is unknown (deny),
    # even with permissions that would otherwise satisfy it. (The autouse conftest
    # fixture re-seeds the active policy after this test.)
    reset_active_registry()
    decision = evaluate_capability("sales.report.customer", {"read-sales", "read-customers"})
    assert decision.allowed is False
    assert decision.reason == REASON_UNKNOWN_CAPABILITY
