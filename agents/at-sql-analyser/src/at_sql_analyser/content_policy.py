"""Entitlement-gated content policy for the SQL analyst's shared state section.

Mirrors the orchestrator's policy: the agent writes its own working section to
the OWNER's owner-scoped store with the FULL, non-redacted result when the owner
is entitled to the skill that produced it (no PII redaction for a user who can
already retrieve the data), while always stripping secrets and bounding size.

The agent NEVER writes raw SQL or rows anyway (only metadata + the composed
answer), so this governs the answer/summary it persists for cross-turn context.
"""

from __future__ import annotations

from collections.abc import Mapping

from .auth.snapshot import VerifiedSnapshot

_SECRET_KEY_TOKENS: tuple[str, ...] = (
    "token",
    "secret",
    "password",
    "passwd",
    "authorization",
    "apikey",
    "api_key",
    "bearer",
    "credential",
    "cookie",
)
_REDACTED = "[redacted]"
_MAX_STRING = 8192


def is_entitled(snapshot: VerifiedSnapshot, capability_id: str) -> bool:
    """Whether the owner's verified snapshot entitles them to this capability."""
    if not capability_id:
        return True
    return capability_id in snapshot.capability_allowlist


def _strip_secrets(value: object, *, depth: int = 0) -> object:
    if depth >= 8:
        return "[truncated]"
    if isinstance(value, bool) or value is None or isinstance(value, int | float):
        return value
    if isinstance(value, str):
        return value if len(value) <= _MAX_STRING else value[:_MAX_STRING] + "…"
    if isinstance(value, Mapping):
        result: dict[str, object] = {}
        for key, item in value.items():
            key_str = str(key)
            lowered = key_str.lower()
            if any(token in lowered for token in _SECRET_KEY_TOKENS):
                result[key_str] = _REDACTED
            else:
                result[key_str] = _strip_secrets(item, depth=depth + 1)
        return result
    if isinstance(value, (list, tuple)):
        return [_strip_secrets(item, depth=depth + 1) for item in value]
    text = str(value)
    return text if len(text) <= _MAX_STRING else text[:_MAX_STRING] + "…"


def resolve_text(text: str, *, snapshot: VerifiedSnapshot, capability_id: str = "") -> str:
    """Full text for an entitled owner; empty when not entitled (default deny)."""
    if not is_entitled(snapshot, capability_id):
        return ""
    return text if len(text) <= _MAX_STRING else text[:_MAX_STRING] + "…"


def resolve_content(
    value: object, *, snapshot: VerifiedSnapshot, capability_id: str = ""
) -> object:
    """Full secret-stripped content for an entitled owner; withheld otherwise."""
    if not is_entitled(snapshot, capability_id):
        return {"withheld": True, "reason": "not_entitled"}
    return _strip_secrets(value)
