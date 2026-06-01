from __future__ import annotations

from at_sql_analyser.auth.snapshot import compute_snapshot_hash


def test_hash_is_order_and_duplicate_invariant() -> None:
    a = compute_snapshot_hash(
        owner_subject="u1",
        roles=["admin", "sales-user", "admin"],
        permissions=["read-customers", "read-sales"],
        capability_allowlist=["data.analyse.read"],
        issued_at_epoch_s=1000,
        expires_at_epoch_s=2000,
    )
    b = compute_snapshot_hash(
        owner_subject="u1",
        roles=["sales-user", "admin"],
        permissions=["read-sales", "read-customers"],
        capability_allowlist=["data.analyse.read"],
        issued_at_epoch_s=1000,
        expires_at_epoch_s=2000,
    )
    assert a == b
    assert a.startswith("sha256:")


def test_hash_changes_with_content() -> None:
    base = compute_snapshot_hash(
        owner_subject="u1",
        roles=["admin"],
        permissions=["read-sales"],
        capability_allowlist=["data.analyse.read"],
        issued_at_epoch_s=1000,
        expires_at_epoch_s=2000,
    )
    changed = compute_snapshot_hash(
        owner_subject="u2",
        roles=["admin"],
        permissions=["read-sales"],
        capability_allowlist=["data.analyse.read"],
        issued_at_epoch_s=1000,
        expires_at_epoch_s=2000,
    )
    assert base != changed
