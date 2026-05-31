"""Layer B — the authoritative, default-deny code policy gate.

Run before EVERY agent/tool hop, regardless of what the planner produced. The
LLM/planner never makes an authorization decision and can never widen the
allowlist; a prompt-injected instruction to "use tool X" still hits this gate
and is denied if the user lacks the permission.

Each downstream A2A agent and MCP server repeats an equivalent check rather than
trusting the worker (defense in depth).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .registry import get_capability, roles_grant_permission

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
    roles: Iterable[str],
    *,
    has_approval: bool = False,
) -> PolicyDecision:
    """Authoritative capability decision against the snapshot's realm roles.

    Default deny:
      - unknown capability -> deny
      - any required permission not granted by the roles -> deny
      - high-risk capability without a recorded approval -> deny
    """
    roles_list = list(roles)
    capability = get_capability(capability_id)
    if capability is None or not capability.required_permissions:
        return PolicyDecision(False, capability_id, REASON_UNKNOWN_CAPABILITY)

    for permission in capability.required_permissions:
        if not roles_grant_permission(roles_list, permission):
            return PolicyDecision(
                False, capability_id, REASON_MISSING_PERMISSION, missing_permission=permission
            )

    if capability.risk == "high" and not has_approval:
        return PolicyDecision(False, capability_id, REASON_APPROVAL_REQUIRED)

    return PolicyDecision(True, capability_id, REASON_ALLOWED)
