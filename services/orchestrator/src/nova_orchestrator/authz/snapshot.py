"""Entitlement-snapshot integrity verification (execution-plane side).

The Node control plane captures an immutable entitlement snapshot at the API
edge and pins a `sha256` hash to the run. Before every hop the worker recomputes
this hash from the snapshot loaded out of `postgres-agents` and fails closed on
any mismatch or expiry.

The canonical form MUST stay byte-identical to the TypeScript implementation in
`backend-services/api/src/modules/agent-runs/entitlement-snapshot.ts`:

  - fixed key order: ownerSubject, roles, permissions, capabilityAllowlist,
    issuedAtEpochS, expiresAtEpochS
  - roles / permissions / capabilityAllowlist sorted ascending, de-duplicated
  - timestamps as integer epoch SECONDS
  - compact JSON separators (",", ":"), UTF-8, then sha256 hex, "sha256:" prefix
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True)
class EntitlementSnapshot:
    owner_subject: str
    owner_user_id: str
    roles: tuple[str, ...]
    permissions: frozenset[str]
    capability_allowlist: frozenset[str]
    snapshot_hash: str
    issued_at: datetime
    expires_at: datetime


def _sorted_unique(values: Iterable[str]) -> list[str]:
    return sorted(set(values))


def _epoch_seconds(value: datetime) -> int:
    # Normalize naive datetimes to UTC; DB rows are timestamptz.
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp())


def compute_snapshot_hash(
    *,
    owner_subject: str,
    roles: Iterable[str],
    permissions: Iterable[str],
    capability_allowlist: Iterable[str],
    issued_at_epoch_s: int,
    expires_at_epoch_s: int,
) -> str:
    canonical = json.dumps(
        {
            "ownerSubject": owner_subject,
            "roles": _sorted_unique(roles),
            "permissions": _sorted_unique(permissions),
            "capabilityAllowlist": _sorted_unique(capability_allowlist),
            "issuedAtEpochS": issued_at_epoch_s,
            "expiresAtEpochS": expires_at_epoch_s,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def recompute_hash(snapshot: EntitlementSnapshot) -> str:
    return compute_snapshot_hash(
        owner_subject=snapshot.owner_subject,
        roles=snapshot.roles,
        permissions=snapshot.permissions,
        capability_allowlist=snapshot.capability_allowlist,
        issued_at_epoch_s=_epoch_seconds(snapshot.issued_at),
        expires_at_epoch_s=_epoch_seconds(snapshot.expires_at),
    )


class SnapshotIntegrityError(Exception):
    """Raised when a snapshot is tampered, mismatched, or expired (fail closed)."""


def verify_snapshot(
    snapshot: EntitlementSnapshot,
    *,
    expected_hash: str,
    now: datetime | None = None,
) -> None:
    """Fail closed unless the snapshot hash matches AND it has not expired."""
    recomputed = recompute_hash(snapshot)
    if recomputed != snapshot.snapshot_hash:
        raise SnapshotIntegrityError("snapshot hash does not match stored hash")
    if recomputed != expected_hash:
        raise SnapshotIntegrityError("snapshot hash does not match the enqueued run hash")

    current = now or datetime.now(UTC)
    expires_at = snapshot.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if current >= expires_at:
        raise SnapshotIntegrityError("entitlement snapshot has expired")
