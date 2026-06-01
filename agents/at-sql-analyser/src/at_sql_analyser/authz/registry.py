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


def write_capability_ids() -> tuple[str, ...]:
    """Concrete, cataloged write capabilities the agent may dispatch.

    This is the closed set the write planner can ever be shown (Layer A): the
    ``delegated`` (agent-internal) write capabilities. It excludes the
    ``data.act.write`` umbrella (``delegated == False``), so the agent can never
    mint new write authority; each id is still re-gated independently before
    dispatch (Layer B) and re-checked by the Node gateway.
    """
    return tuple(
        capability.id
        for capability in CAPABILITY_CATALOG
        if capability.mode == "write" and capability.delegated
    )


def read_capability_ids() -> tuple[str, ...]:
    """Concrete, cataloged STRUCTURED read capabilities the agent may invoke.

    The closed set shown to the read planner (Layer A): the ``delegated``
    (agent-internal) read capabilities — resolvers (``customers.search``),
    detail reads (``sales.get``), and scoped reports (``sales.report.customer``).
    It excludes the ``data.analyse.read`` umbrella and the free-form SQL
    ``mcp-tool`` capabilities (both ``delegated == False``). Each id is re-gated
    independently before dispatch (Layer B) and re-checked by the Node gateway.
    """
    return tuple(
        capability.id
        for capability in CAPABILITY_CATALOG
        if capability.mode == "read" and capability.delegated
    )
