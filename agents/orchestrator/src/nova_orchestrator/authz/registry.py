"""Lookup helpers over the dynamic, DB-driven RBAC registry.

These read the process-wide active registry (fetched from the Node control plane
by :mod:`rbac_registry`) and mirror the TypeScript helpers in the API's
``RbacRegistry`` (``permissionsForRoles``, ``rolesGrantPermission``,
``getCapability``, ``permissionsSatisfyCapability``), so authorization decisions
are identical on both sides. Default deny: when no registry is loaded (startup or
outage) every lookup denies.
"""

from __future__ import annotations

from collections.abc import Iterable

from .rbac_registry import CapabilityDescriptor, get_active_registry


def permissions_for_roles(roles: Iterable[str]) -> set[str]:
    """Flattened, de-duplicated permission set granted by the roles."""
    registry = get_active_registry()
    granted: set[str] = set()
    if registry is None:
        return granted
    for role in roles:
        granted.update(registry.role_permissions.get(role, ()))
    return granted


def roles_grant_permission(roles: Iterable[str], required: str) -> bool:
    """True when at least one role grants the required permission (default deny)."""
    registry = get_active_registry()
    if registry is None:
        return False
    return any(required in registry.role_permissions.get(role, ()) for role in roles)


def get_capability(capability_id: str) -> CapabilityDescriptor | None:
    """Look up a capability descriptor. Unknown ids / no registry return None (deny)."""
    registry = get_active_registry()
    if registry is None:
        return None
    return registry.capability(capability_id)


def permissions_satisfy_capability(
    capability: CapabilityDescriptor, permissions: set[str]
) -> bool:
    """AND-composition: enabled, declares permissions, and all are present (deny)."""
    if not capability.enabled or not capability.required_permissions:
        return False
    return all(permission in permissions for permission in capability.required_permissions)


def capabilities_for_permissions(permissions: set[str]) -> list[CapabilityDescriptor]:
    """Capabilities whose required permissions are fully satisfied (default deny)."""
    registry = get_active_registry()
    if registry is None:
        return []
    return [
        capability
        for capability in registry.capabilities
        if permissions_satisfy_capability(capability, permissions)
    ]
