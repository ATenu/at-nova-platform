"""Entitlement-gated content policy: full data for the entitled owner.

The owner-scoped agent-state store keeps the FULL, non-redacted result when the
owner is entitled to the producing capability (no PII redaction for someone who
can already retrieve it), while always stripping secrets and withholding content
from capabilities outside the verified snapshot (default deny).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from nova_orchestrator.authz.snapshot import EntitlementSnapshot
from nova_orchestrator.content_policy import is_entitled, resolve_content, resolve_text


def _snapshot(allowlist: set[str]) -> EntitlementSnapshot:
    now = datetime.now(UTC)
    return EntitlementSnapshot(
        owner_subject="user-1",
        owner_user_id="00000000-0000-0000-0000-000000000001",
        roles=("sales_rep",),
        permissions=frozenset({"data:read"}),
        capability_allowlist=frozenset(allowlist),
        snapshot_hash="sha256:test",
        issued_at=now,
        expires_at=now + timedelta(hours=1),
    )


def test_entitled_owner_sees_full_unredacted_pii() -> None:
    snap = _snapshot({"data.analyse.read"})
    payload = {"customerName": "Jane Doe", "email": "jane@example.com", "balance": 1234}
    resolved = resolve_content(payload, snapshot=snap, capability_id="data.analyse.read")
    # PII is preserved verbatim for an entitled owner — nothing is stripped.
    assert resolved == payload


def test_secrets_are_always_stripped_even_for_entitled_owner() -> None:
    snap = _snapshot({"data.analyse.read"})
    payload = {"email": "jane@example.com", "access_token": "super-secret"}
    resolved = resolve_content(payload, snapshot=snap, capability_id="data.analyse.read")
    assert isinstance(resolved, dict)
    assert resolved["email"] == "jane@example.com"
    assert resolved["access_token"] == "[redacted]"


def test_content_withheld_when_capability_not_entitled() -> None:
    snap = _snapshot(set())  # owner entitled to nothing
    resolved = resolve_content({"x": 1}, snapshot=snap, capability_id="data.analyse.read")
    assert resolved == {"withheld": True, "reason": "not_entitled"}


def test_non_capability_content_is_allowed() -> None:
    # The user's own prompt / answer has no capability id; the owner always sees it.
    snap = _snapshot(set())
    assert resolve_text("show me my customers", snapshot=snap) == "show me my customers"
    assert is_entitled(snap, "") is True


def test_resolve_text_withheld_for_unentitled_capability() -> None:
    snap = _snapshot(set())
    assert resolve_text("secret answer", snapshot=snap, capability_id="data.analyse.read") == ""


def test_resolver_capability_pii_preserved_for_entitled_owner() -> None:
    # The conversational name->id resolvers (e.g. customers.search) return display
    # names/emails. For an entitled owner this is their own working memory, so the
    # store keeps it verbatim (only secrets are ever stripped).
    snap = _snapshot({"customers.search"})
    payload = {"customers": [{"id": "c-1", "fullName": "Jane Doe", "email": "jane@example.com"}]}
    resolved = resolve_content(payload, snapshot=snap, capability_id="customers.search")
    assert resolved == payload


def test_resolver_capability_withheld_when_not_entitled() -> None:
    # Default deny: a resolver the owner is not entitled to never reaches the store.
    snap = _snapshot({"data.analyse.read"})
    resolved = resolve_content(
        {"customers": [{"id": "c-1", "fullName": "Jane Doe"}]},
        snapshot=snap,
        capability_id="customers.search",
    )
    assert resolved == {"withheld": True, "reason": "not_entitled"}
