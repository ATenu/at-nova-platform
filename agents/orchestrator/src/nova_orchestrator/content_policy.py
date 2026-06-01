"""Entitlement-gated content policy for the shared agent-state store.

The shared agent-state store (``redis-agent``) holds the OWNER's own working
context, keyed by their run/conversation. Business data and PII are therefore
NOT redacted when the owner is entitled to the capability that produced them: an
entitled user sees the full, non-redacted result they could already retrieve
directly through the same capability. This is the deliberate policy for this
store (it is owner-scoped working memory, not shared telemetry).

Two invariants still hold regardless of entitlement (decision: secrets are not
"information the user is entitled to retrieve" — they are credentials):

  - Secrets / tokens / credentials are NEVER stored. ``safe_io`` strips them by
    key name and bounds size/depth so a single result cannot bloat Redis.
  - Content from a capability OUTSIDE the owner's verified entitlement snapshot
    is withheld (default deny): a downstream bug can never persist data the
    owner was not entitled to.

Operational telemetry (run events over SSE/webhook, logs, traces) keeps its own
redaction discipline elsewhere; this module governs ONLY the owner-scoped store.
"""

from __future__ import annotations

from .authz.snapshot import EntitlementSnapshot
from .events import safe_io

_WITHHELD: dict[str, object] = {"withheld": True, "reason": "not_entitled"}


def is_entitled(snapshot: EntitlementSnapshot, capability_id: str) -> bool:
    """Whether the owner's verified snapshot entitles them to this capability.

    The ``capability_allowlist`` is the authoritative record of the
    role+permission decision captured at the API edge (Layer A); membership here
    means the owner has the role and permissions to retrieve this capability's
    data. Empty/unknown capability ids are treated as a non-capability content
    source (e.g. the user's own prompt) and are allowed through.
    """
    if not capability_id:
        return True
    return capability_id in snapshot.capability_allowlist


def resolve_content(
    value: object,
    *,
    snapshot: EntitlementSnapshot,
    capability_id: str = "",
) -> object:
    """Return the storable form of ``value`` for the owner-scoped state store.

    Full, non-redacted (only secret-stripped) content when the owner is entitled
    to ``capability_id``; a minimal withheld marker otherwise (default deny).
    """
    if not is_entitled(snapshot, capability_id):
        return dict(_WITHHELD)
    # Strip secrets/tokens and bound size; business data and PII are preserved
    # because the entitled owner is allowed to see them.
    return safe_io(value)


def resolve_text(
    text: str,
    *,
    snapshot: EntitlementSnapshot,
    capability_id: str = "",
) -> str:
    """Entitlement-gated variant for plain text (e.g. an answer/summary)."""
    if not is_entitled(snapshot, capability_id):
        return ""
    resolved = safe_io(text)
    return resolved if isinstance(resolved, str) else str(resolved)
