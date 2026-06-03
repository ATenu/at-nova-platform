"""Per-skill / per-action authorization for the agent (Layer B + allowlist check).

Thin, typed wrapper over the shared `evaluate_capability` gate. Used in two places:

  - skill entry: before the harness runs a skill (e.g. `data.analyse.read`), the
    agent confirms the verified snapshot entitles it;
  - concrete write dispatch: before invoking any cataloged write capability via
    the Node tool gateway, the agent re-runs the gate WITH the approval flag, so
    high-risk writes are denied until a human approval is recorded.

Both also require membership in the snapshot's capability allowlist (Layer A,
computed at the API edge) as defense in depth. Default deny.
"""

from __future__ import annotations

from ..authz.policy_gate import PolicyDecision, evaluate_capability
from .snapshot import VerifiedSnapshot

REASON_NOT_IN_ALLOWLIST = "not_in_allowlist"


def authorize(
    snapshot: VerifiedSnapshot,
    capability_id: str,
    *,
    has_approval: bool = False,
) -> PolicyDecision:
    """Authoritative decision for a capability against the verified snapshot."""
    if capability_id not in snapshot.capability_allowlist:
        return PolicyDecision(False, capability_id, REASON_NOT_IN_ALLOWLIST)
    return evaluate_capability(capability_id, snapshot.permissions, has_approval=has_approval)


def is_entitled(snapshot: VerifiedSnapshot, capability_id: str) -> bool:
    """Layer A helper: is the caller entitled to this capability at all?"""
    return authorize(snapshot, capability_id).allowed
