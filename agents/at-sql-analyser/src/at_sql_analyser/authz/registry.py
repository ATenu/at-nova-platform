"""Lookup helpers over the dynamic, DB-driven RBAC registry.

These read the process-wide active registry (fetched from the Node control plane
by :mod:`rbac_registry`) and mirror the TypeScript helpers in the API's
``RbacRegistry``, so the agent's Layer B decisions are identical to the worker's
and the control plane's. Default deny: when no registry is loaded (startup or
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


def write_capability_ids() -> tuple[str, ...]:
    """Concrete, cataloged write capabilities the agent may dispatch.

    The closed set the write planner can ever be shown (Layer A): the
    ``delegated`` (agent-internal), enabled write capabilities. It excludes the
    ``data.act.write`` umbrella (``delegated == False``), so the agent can never
    mint new write authority; each id is still re-gated independently before
    dispatch (Layer B) and re-checked by the Node gateway. Empty when no registry
    is loaded (default deny).
    """
    registry = get_active_registry()
    if registry is None:
        return ()
    return tuple(
        capability.id
        for capability in registry.capabilities
        if capability.mode == "write" and capability.delegated and capability.enabled
    )


def read_capability_ids() -> tuple[str, ...]:
    """Concrete, cataloged STRUCTURED read capabilities the agent may invoke.

    The closed set shown to the read planner (Layer A): the ``delegated``
    (agent-internal), enabled read capabilities. It excludes the
    ``data.analyse.read`` umbrella and the free-form SQL ``mcp-tool`` capabilities
    (both ``delegated == False``). Each id is re-gated independently before
    dispatch (Layer B) and re-checked by the Node gateway. Empty when no registry
    is loaded (default deny).
    """
    registry = get_active_registry()
    if registry is None:
        return ()
    return tuple(
        capability.id
        for capability in registry.capabilities
        if capability.mode == "read" and capability.delegated and capability.enabled
    )
