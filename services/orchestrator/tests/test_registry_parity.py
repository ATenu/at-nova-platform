"""Sanity checks that the generated registry is internally consistent.

Drift against the TypeScript source of truth is caught in CI by regenerating
`nova_authz.py` and diffing; these tests guard the runtime invariants the
policy gate relies on.
"""

from __future__ import annotations

from nova_orchestrator.authz.nova_authz import (
    CAPABILITY_CATALOG,
    PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLES,
)
from nova_orchestrator.authz.registry import (
    capabilities_for_permissions,
    permissions_for_roles,
    roles_grant_permission,
)

_PERMISSION_SET = set(PERMISSIONS)


def test_every_role_grants_only_defined_permissions() -> None:
    for role, perms in ROLE_PERMISSIONS.items():
        assert role in ROLES
        for perm in perms:
            assert perm in _PERMISSION_SET, f"{role} grants unknown permission {perm}"


def test_capabilities_reference_only_defined_permissions() -> None:
    for capability in CAPABILITY_CATALOG:
        assert capability.required_permissions, f"{capability.id} has no required permissions"
        for perm in capability.required_permissions:
            assert perm in _PERMISSION_SET


def test_capability_ids_are_unique() -> None:
    ids = [c.id for c in CAPABILITY_CATALOG]
    assert len(ids) == len(set(ids))


def test_agent_run_lifecycle_permissions_present_for_all_roles() -> None:
    for role in ROLES:
        granted = set(ROLE_PERMISSIONS[role])
        assert {"create-agent-run", "read-agent-run", "cancel-agent-run"} <= granted


def test_capabilities_for_permissions_is_default_deny() -> None:
    assert capabilities_for_permissions(set()) == []


def test_sales_user_can_report_but_compliance_cannot() -> None:
    sales_perms = permissions_for_roles(["sales-user"])
    allowed_ids = {c.id for c in capabilities_for_permissions(sales_perms)}
    assert "sales.report.customer" in allowed_ids

    assert roles_grant_permission(["sales-user"], "read-sales") is True
    assert roles_grant_permission(["ops-compliance"], "read-sales") is False
