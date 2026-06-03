"""Dynamic, DB-driven RBAC registry client for the SQL analyst agent.

The authoritative authorization policy (role->permission grants and the
agent/MCP capability catalog with its required permissions, risk and enabled
flags) lives in PostgreSQL and is served by the Node control plane at
``GET /internal/rbac/registry`` (audience-restricted service token, azp pinned).
This module fetches that policy, caches it by its monotonic ``revision``
(revalidated with ``If-None-Match``), and publishes it as the process-wide active
registry the agent's Layer B gate reads.

Fail closed: when no registry is loaded (startup or outage) every lookup denies,
so a skill or concrete capability is never authorized against absent policy. The
agent re-runs this independently of the worker (defense in depth).
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

import httpx

from ..auth.tokens import ServiceTokenClient, ServiceTokenError

logger = logging.getLogger(__name__)

_TIMEOUT_S = 10.0


class RbacRegistryError(RuntimeError):
    """Raised when the dynamic registry cannot be fetched (fail closed)."""


@dataclass(frozen=True)
class CapabilityDescriptor:
    """One agent skill / MCP tool and its admin-editable authorization policy."""

    id: str
    kind: str
    mode: str
    required_permissions: tuple[str, ...]
    risk: str
    resource_scoped: bool
    delegated: bool
    enabled: bool
    # Opt-in human-approval gate (default false), decoupled from ``risk``: by
    # default permission consent alone authorizes execution. Admin-editable.
    requires_approval: bool = False


class RbacRegistry:
    """Immutable, query-optimized view of the effective authorization policy."""

    def __init__(
        self,
        *,
        revision: int,
        capabilities: tuple[CapabilityDescriptor, ...],
        role_permissions: dict[str, tuple[str, ...]],
    ) -> None:
        self.revision = revision
        self.capabilities = capabilities
        self.role_permissions = role_permissions
        self._by_id = {capability.id: capability for capability in capabilities}

    def capability(self, capability_id: str) -> CapabilityDescriptor | None:
        return self._by_id.get(capability_id)


def _parse_capability(item: dict[str, Any]) -> CapabilityDescriptor:
    return CapabilityDescriptor(
        id=str(item["id"]),
        kind=str(item.get("kind", "")),
        mode=str(item.get("mode", "")),
        required_permissions=tuple(str(p) for p in item.get("requiredPermissions", [])),
        risk=str(item.get("risk", "low")),
        resource_scoped=bool(item.get("resourceScoped", False)),
        delegated=bool(item.get("delegated", False)),
        enabled=bool(item.get("enabled", True)),
        requires_approval=bool(item.get("requiresApproval", False)),
    )


def registry_from_payload(data: dict[str, Any]) -> RbacRegistry:
    """Build a registry from the JSON served by ``/internal/rbac/registry``."""
    raw_capabilities = data.get("capabilities", [])
    capabilities = tuple(
        _parse_capability(item) for item in raw_capabilities if isinstance(item, dict)
    )
    role_permissions: dict[str, tuple[str, ...]] = {}
    raw_role_permissions = data.get("rolePermissions", {})
    if isinstance(raw_role_permissions, dict):
        for role, perms in raw_role_permissions.items():
            if isinstance(perms, list):
                role_permissions[str(role)] = tuple(str(p) for p in perms)
    return RbacRegistry(
        revision=int(data.get("revision", 0)),
        capabilities=capabilities,
        role_permissions=role_permissions,
    )


# ---- Process-wide active registry (read by the Layer B gate) ---------------

_lock = threading.Lock()
_active: RbacRegistry | None = None


def get_active_registry() -> RbacRegistry | None:
    """The current effective policy, or ``None`` when none is loaded (deny)."""
    with _lock:
        return _active


def set_active_registry(registry: RbacRegistry) -> None:
    with _lock:
        global _active
        _active = registry


def reset_active_registry() -> None:
    """Clear the active policy so every lookup fails closed (deny)."""
    with _lock:
        global _active
        _active = None


class RbacRegistryClient:
    """Fetches the dynamic registry and publishes it as the active policy.

    Caches the last good registry and revalidates with ``If-None-Match`` keyed by
    revision. On any hard failure it raises ``RbacRegistryError``; callers fail
    closed by clearing the active registry.
    """

    def __init__(
        self,
        *,
        base_url: str,
        tokens: ServiceTokenClient,
        audience_scope: str | None = None,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/internal/rbac/registry"
        self._tokens = tokens
        self._scope = audience_scope
        self._cached: RbacRegistry | None = None

    def refresh(self) -> RbacRegistry:
        """Fetch (or revalidate) the registry and set it active. Raises on failure."""
        try:
            token = self._tokens.get_token(self._scope)
        except ServiceTokenError as exc:
            raise RbacRegistryError("could not mint a registry token") from exc

        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        if self._cached is not None:
            headers["If-None-Match"] = f'W/"rbac-{self._cached.revision}"'

        try:
            response = httpx.get(self._url, headers=headers, timeout=_TIMEOUT_S)
        except httpx.HTTPError as exc:
            raise RbacRegistryError("rbac registry unreachable") from exc

        if response.status_code == 304 and self._cached is not None:
            set_active_registry(self._cached)
            return self._cached
        if response.status_code == 401:
            self._tokens.invalidate(self._scope)
        if response.status_code != 200:
            raise RbacRegistryError(f"rbac registry rejected (status={response.status_code})")

        try:
            body = response.json()
        except ValueError as exc:
            raise RbacRegistryError("malformed rbac registry response") from exc
        if not isinstance(body, dict):
            raise RbacRegistryError("unexpected rbac registry response shape")

        registry = registry_from_payload(body)
        self._cached = registry
        set_active_registry(registry)
        return registry
