"""GENERATED FILE — do not edit by hand.

Mirrors the canonical TypeScript RBAC + capability registry in `@nova/shared`.
Regenerate with `scripts/generate_nova_authz.py`; CI fails on drift.
"""

from __future__ import annotations

from dataclasses import dataclass


PERMISSIONS: tuple[str, ...] = ("read-customers", "write-customers", "create-issues", "read-issues", "write-issues", "read-sales", "write-sales", "read-permissions", "write-permissions", "read-actions", "write-actions", "read-sop", "write-sop", "read-users", "write-users", "create-agent-run", "read-agent-run", "cancel-agent-run",)

ROLES: tuple[str, ...] = ("sales-user", "support-operations-user", "admin", "customer-support", "ops-compliance",)

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "sales-user": ("read-customers", "write-customers", "read-issues", "read-sales", "write-sales", "read-actions", "read-sop", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "support-operations-user": ("read-customers", "write-customers", "read-issues", "write-issues", "read-sales", "read-actions", "write-actions", "read-sop", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "admin": ("read-customers", "write-customers", "create-issues", "read-issues", "write-issues", "read-sales", "write-sales", "read-permissions", "write-permissions", "read-actions", "write-actions", "read-sop", "write-sop", "read-users", "write-users", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "customer-support": ("read-customers", "create-issues", "read-issues", "write-issues", "read-sales", "read-actions", "write-actions", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "ops-compliance": ("read-sop", "write-sop", "create-agent-run", "read-agent-run", "cancel-agent-run",),
}


@dataclass(frozen=True)
class CapabilityDescriptor:
    id: str
    kind: str
    mode: str
    required_permissions: tuple[str, ...]
    risk: str
    resource_scoped: bool
    delegated: bool


CAPABILITY_CATALOG: tuple[CapabilityDescriptor, ...] = (
    CapabilityDescriptor(
        id="sales.report.customer",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales", "read-customers",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sales.products.forCustomer",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales", "read-customers",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sales.create",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-sales",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="issues.list.pendingForCustomer",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-issues", "read-customers",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.next",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-actions",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.markCompleted",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-actions",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="issues.create",
        kind="agent-skill",
        mode="write",
        required_permissions=("create-issues",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sop.read",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sop",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="customers.search",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-customers",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="customers.get",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-customers",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="products.search",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="products.get",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sales.list",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sales.get",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="issues.list",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-issues",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="issues.get",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-issues",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.list",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-actions",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.get",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-actions",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.addComment",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-actions",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="actions.update",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-actions",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="issues.update",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-issues",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sop.create",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-sop",),
        risk="low",
        resource_scoped=False,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sop.update",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-sop",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="sop.addVersion",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-sop",),
        risk="low",
        resource_scoped=True,
        delegated=True,
    ),
    CapabilityDescriptor(
        id="data.schema.describe",
        kind="mcp-tool",
        mode="read",
        required_permissions=("create-agent-run",),
        risk="low",
        resource_scoped=False,
        delegated=False,
    ),
    CapabilityDescriptor(
        id="data.query.select",
        kind="mcp-tool",
        mode="read",
        required_permissions=("create-agent-run",),
        risk="low",
        resource_scoped=True,
        delegated=False,
    ),
    CapabilityDescriptor(
        id="data.analyse.read",
        kind="agent-skill",
        mode="read",
        required_permissions=("create-agent-run",),
        risk="low",
        resource_scoped=True,
        delegated=False,
    ),
    CapabilityDescriptor(
        id="data.act.write",
        kind="agent-skill",
        mode="write",
        required_permissions=("create-agent-run",),
        risk="high",
        resource_scoped=True,
        delegated=False,
    ),
)
