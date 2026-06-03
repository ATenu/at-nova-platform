"""Layer B — the authoritative, default-deny code policy gate (agent side).

The agent re-runs this gate for every skill and every concrete write capability
it is about to dispatch, regardless of what the planner produced and regardless
of the worker having already gated the hop. The LLM/planner never makes an
authorization decision and can never widen the allowlist; a prompt-injected
"use capability X" still hits this gate and is denied if the user lacks the
permission. This is defense in depth: an independent copy of the worker's gate.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .registry import get_capability

# Decision reasons (stable, machine-readable; surfaced in the audit log).
REASON_ALLOWED = "allowed"
REASON_UNKNOWN_CAPABILITY = "unknown_capability"
REASON_MISSING_PERMISSION = "missing_permission"
REASON_APPROVAL_REQUIRED = "approval_required"


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    capability_id: str
    reason: str
    missing_permission: str | None = None


def evaluate_capability(
    capability_id: str,
    permissions: Iterable[str],
    *,
    has_approval: bool = False,
) -> PolicyDecision:
    """Authoritative capability decision against the snapshot's effective permissions.

    The integrity-hashed entitlement snapshot already carries the owner's
    effective permission set, so Layer B authorizes directly against permissions
    (the registry binds each capability to its required permissions). Default deny:
      - unknown / disabled / permission-less capability -> deny
      - any required permission absent from the snapshot -> deny
      - capability admin-flagged ``requires_approval`` without a recorded approval -> deny

    Approval is an explicit, admin-editable capability property (default false),
    DECOUPLED from ``risk``: by default a capability whose required permissions
    are granted is allowed regardless of risk level. ``risk`` is informational
    metadata and never gates execution by itself.
    """
    granted = set(permissions)
    capability = get_capability(capability_id)
    if capability is None or not capability.enabled or not capability.required_permissions:
        return PolicyDecision(False, capability_id, REASON_UNKNOWN_CAPABILITY)

    for permission in capability.required_permissions:
        if permission not in granted:
            return PolicyDecision(
                False, capability_id, REASON_MISSING_PERMISSION, missing_permission=permission
            )

    if capability.requires_approval and not has_approval:
        return PolicyDecision(False, capability_id, REASON_APPROVAL_REQUIRED)

    return PolicyDecision(True, capability_id, REASON_ALLOWED)
