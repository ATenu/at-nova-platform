"""Parity helpers over the generated `nova_authz` registry.

These mirror the TypeScript helpers in `@nova/shared`
(`permissionsForRoles`, `rolesGrantPermission`, `capabilitiesForPermissions`,
`getCapability`) so authorization decisions are identical on both sides.
"""

from __future__ import annotations

from collections.abc import Iterable

from .nova_authz import CAPABILITY_CATALOG, ROLE_PERMISSIONS, CapabilityDescriptor

_CAPABILITY_BY_ID: dict[str, CapabilityDescriptor] = {
    capability.id: capability for capability in CAPABILITY_CATALOG
}


def permissions_for_roles(roles: Iterable[str]) -> set[str]:
    """Flattened, de-duplicated permission set granted by the roles."""
    granted: set[str] = set()
    for role in roles:
        granted.update(ROLE_PERMISSIONS.get(role, ()))
    return granted


def roles_grant_permission(roles: Iterable[str], required: str) -> bool:
    """True when at least one role grants the required permission (default deny)."""
    return any(required in ROLE_PERMISSIONS.get(role, ()) for role in roles)


def get_capability(capability_id: str) -> CapabilityDescriptor | None:
    """Look up a capability descriptor. Unknown ids return None (deny)."""
    return _CAPABILITY_BY_ID.get(capability_id)


def permissions_satisfy_capability(
    capability: CapabilityDescriptor, permissions: set[str]
) -> bool:
    """AND-composition: every required permission must be present."""
    return all(permission in permissions for permission in capability.required_permissions)


def capabilities_for_permissions(permissions: set[str]) -> list[CapabilityDescriptor]:
    """Capabilities whose required permissions are fully satisfied (default deny)."""
    return [
        capability
        for capability in CAPABILITY_CATALOG
        if permissions_satisfy_capability(capability, permissions)
    ]
