"""GENERATED FILE — do not edit by hand.

Mirrors the canonical TypeScript RBAC + capability registry in `@nova/shared`.
Regenerate with `scripts/generate_nova_authz.py`; CI fails on drift.
"""

from __future__ import annotations

from dataclasses import dataclass


PERMISSIONS: tuple[str, ...] = ("read-customers", "write-customers", "create-issues", "read-issues", "write-issues", "read-sales", "write-sales", "read-permissions", "write-permissions", "read-actions", "write-actions", "read-sop", "write-sop", "read-users", "write-users", "read-data", "create-agent-run", "read-agent-run", "cancel-agent-run",)

ROLES: tuple[str, ...] = ("sales-user", "support-operations-user", "admin", "customer-support", "ops-compliance",)

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "sales-user": ("read-customers", "write-customers", "read-issues", "read-sales", "write-sales", "read-actions", "read-sop", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "support-operations-user": ("read-customers", "write-customers", "read-issues", "write-issues", "read-sales", "read-actions", "write-actions", "read-sop", "read-data", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "admin": ("read-customers", "write-customers", "create-issues", "read-issues", "write-issues", "read-sales", "write-sales", "read-permissions", "write-permissions", "read-actions", "write-actions", "read-sop", "write-sop", "read-users", "write-users", "read-data", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "customer-support": ("read-customers", "create-issues", "read-issues", "write-issues", "read-sales", "read-actions", "write-actions", "create-agent-run", "read-agent-run", "cancel-agent-run",),
    "ops-compliance": ("read-sop", "write-sop", "read-data", "create-agent-run", "read-agent-run", "cancel-agent-run",),
}


@dataclass(frozen=True)
class CapabilityDescriptor:
    id: str
    kind: str
    mode: str
    required_permissions: tuple[str, ...]
    risk: str
    resource_scoped: bool


CAPABILITY_CATALOG: tuple[CapabilityDescriptor, ...] = (
    CapabilityDescriptor(
        id="sales.report.customer",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sales", "read-customers",),
        risk="low",
        resource_scoped=True,
    ),
    CapabilityDescriptor(
        id="sales.create",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-sales",),
        risk="low",
        resource_scoped=False,
    ),
    CapabilityDescriptor(
        id="issues.list.pendingForCustomer",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-issues", "read-customers",),
        risk="low",
        resource_scoped=True,
    ),
    CapabilityDescriptor(
        id="actions.next",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-actions",),
        risk="low",
        resource_scoped=False,
    ),
    CapabilityDescriptor(
        id="actions.markCompleted",
        kind="agent-skill",
        mode="write",
        required_permissions=("write-actions",),
        risk="low",
        resource_scoped=True,
    ),
    CapabilityDescriptor(
        id="issues.create",
        kind="agent-skill",
        mode="write",
        required_permissions=("create-issues",),
        risk="low",
        resource_scoped=False,
    ),
    CapabilityDescriptor(
        id="sop.read",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-sop",),
        risk="low",
        resource_scoped=False,
    ),
    CapabilityDescriptor(
        id="data.schema.describe",
        kind="mcp-tool",
        mode="read",
        required_permissions=("read-data",),
        risk="low",
        resource_scoped=False,
    ),
    CapabilityDescriptor(
        id="data.query.select",
        kind="mcp-tool",
        mode="read",
        required_permissions=("read-data",),
        risk="low",
        resource_scoped=True,
    ),
    CapabilityDescriptor(
        id="data.analyse.read",
        kind="agent-skill",
        mode="read",
        required_permissions=("read-data",),
        risk="low",
        resource_scoped=True,
    ),
    CapabilityDescriptor(
        id="data.act.write",
        kind="agent-skill",
        mode="write",
        required_permissions=("read-data",),
        risk="high",
        resource_scoped=True,
    ),
)
