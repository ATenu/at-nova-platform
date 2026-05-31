"""Cross-language integrity contract for the entitlement snapshot hash.

The pinned vector + hash here MUST stay byte-identical to the TypeScript test
`backend-services/api/src/modules/agent-runs/entitlement-snapshot.test.ts`. If
this drifts, the worker will fail closed on every run (which is safe) — but the
fix is to keep both canonicalizers identical, not to relax verification.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TypedDict

import pytest

from nova_orchestrator.authz.snapshot import (
    EntitlementSnapshot,
    SnapshotIntegrityError,
    compute_snapshot_hash,
    verify_snapshot,
)


class _Parity(TypedDict):
    owner_subject: str
    roles: list[str]
    permissions: list[str]
    capability_allowlist: list[str]
    issued_at_epoch_s: int
    expires_at_epoch_s: int


PARITY: _Parity = {
    "owner_subject": "kc-sub-123",
    "roles": ["sales-user"],
    "permissions": ["read-customers", "read-sales", "write-sales"],
    "capability_allowlist": ["sales.create", "sales.report.customer"],
    "issued_at_epoch_s": 1700000000,
    "expires_at_epoch_s": 1700007200,
}
PARITY_HASH = "sha256:c71217485e76b92d4f0d2570de1f1b41fb7ab4ff9a5bfeb546953fa87f12b345"


def test_matches_pinned_cross_language_hash() -> None:
    assert compute_snapshot_hash(**PARITY) == PARITY_HASH


def test_is_order_independent() -> None:
    shuffled = compute_snapshot_hash(
        owner_subject="kc-sub-123",
        roles=["sales-user"],
        permissions=["write-sales", "read-sales", "read-customers"],
        capability_allowlist=["sales.report.customer", "sales.create"],
        issued_at_epoch_s=1700000000,
        expires_at_epoch_s=1700007200,
    )
    assert shuffled == PARITY_HASH


def test_tamper_evident() -> None:
    tampered_subject: _Parity = {**PARITY, "owner_subject": "kc-sub-999"}
    tampered_expiry: _Parity = {**PARITY, "expires_at_epoch_s": 1700007201}
    assert compute_snapshot_hash(**tampered_subject) != PARITY_HASH
    assert compute_snapshot_hash(**tampered_expiry) != PARITY_HASH


def _snapshot(*, expires_at: datetime, snapshot_hash: str) -> EntitlementSnapshot:
    return EntitlementSnapshot(
        owner_subject="kc-sub-123",
        owner_user_id="11111111-1111-1111-1111-111111111111",
        roles=("sales-user",),
        permissions=frozenset({"read-customers", "read-sales", "write-sales"}),
        capability_allowlist=frozenset({"sales.create", "sales.report.customer"}),
        snapshot_hash=snapshot_hash,
        issued_at=datetime.fromtimestamp(1700000000, tz=UTC),
        expires_at=expires_at,
    )


def test_verify_accepts_matching_unexpired_snapshot() -> None:
    from nova_orchestrator.authz.snapshot import recompute_hash

    # Stamp the snapshot with the hash recomputed from its own fields.
    draft = _snapshot(
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        snapshot_hash="sha256:placeholder",
    )
    snapshot = EntitlementSnapshot(**{**draft.__dict__, "snapshot_hash": recompute_hash(draft)})
    verify_snapshot(snapshot, expected_hash=snapshot.snapshot_hash)


def test_verify_rejects_hash_mismatch() -> None:
    snapshot = _snapshot(
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        snapshot_hash="sha256:deadbeef",
    )
    with pytest.raises(SnapshotIntegrityError):
        verify_snapshot(snapshot, expected_hash="sha256:deadbeef")


def test_verify_rejects_expired_snapshot() -> None:
    from nova_orchestrator.authz.snapshot import recompute_hash

    snapshot = _snapshot(
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
        snapshot_hash=PARITY_HASH,
    )
    snapshot = EntitlementSnapshot(
        **{**snapshot.__dict__, "snapshot_hash": recompute_hash(snapshot)}
    )
    with pytest.raises(SnapshotIntegrityError):
        verify_snapshot(snapshot, expected_hash=snapshot.snapshot_hash)
