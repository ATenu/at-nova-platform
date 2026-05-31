"""Entitlement-snapshot fetch + integrity verification (agent side, decision D2).

The agent NEVER trusts the worker's claims. For each run it fetches the immutable
entitlement snapshot from the control plane's audience-gated endpoint
(`GET /internal/agent-runs/:runId/entitlement`), then recomputes the
cross-language canonical hash and checks expiry, failing closed on any mismatch.

The canonical form MUST stay byte-identical to the TypeScript implementation in
`backend-services/packages/shared/src/auth/entitlement-snapshot.ts` and the
orchestrator's `nova_orchestrator.authz.snapshot`:

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

import httpx

from .tokens import ServiceTokenClient

_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class VerifiedSnapshot:
    run_id: str
    owner_subject: str
    roles: tuple[str, ...]
    permissions: frozenset[str]
    capability_allowlist: frozenset[str]
    expires_at: datetime


class SnapshotError(Exception):
    """Raised when a snapshot is unavailable, tampered, mismatched, or expired."""


def _sorted_unique(values: Iterable[str]) -> list[str]:
    return sorted(set(values))


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


def _epoch_seconds(iso: str) -> int:
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp())


class SnapshotClient:
    """Fetches and verifies the entitlement snapshot for a run."""

    def __init__(
        self,
        tokens: ServiceTokenClient,
        *,
        base_url: str,
        audience_scope: str,
    ) -> None:
        self._tokens = tokens
        self._base = base_url.rstrip("/")
        self._scope = audience_scope

    def fetch_verified(self, run_id: str, *, now: datetime | None = None) -> VerifiedSnapshot:
        token = self._tokens.get_token(self._scope)
        url = f"{self._base}/internal/agent-runs/{run_id}/entitlement"
        try:
            response = httpx.get(
                url,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                timeout=_TIMEOUT_S,
            )
        except httpx.HTTPError as exc:
            raise SnapshotError("could not reach the entitlement service") from exc

        if response.status_code == 401:
            self._tokens.invalidate(self._scope)
        if response.status_code >= 400:
            raise SnapshotError("no valid entitlement snapshot for this run")

        body = response.json()
        if not isinstance(body, dict):
            raise SnapshotError("unexpected entitlement response shape")
        return self._verify(body, now=now)

    def _verify(self, body: dict[str, object], *, now: datetime | None) -> VerifiedSnapshot:
        roles_raw = body.get("roles")
        permissions_raw = body.get("permissions")
        allowlist_raw = body.get("capabilityAllowlist")
        if not (
            isinstance(roles_raw, list)
            and isinstance(permissions_raw, list)
            and isinstance(allowlist_raw, list)
        ):
            raise SnapshotError("malformed entitlement snapshot")
        try:
            owner_subject = str(body["ownerSubject"])
            roles = [str(r) for r in roles_raw]
            permissions = [str(p) for p in permissions_raw]
            capability_allowlist = [str(c) for c in allowlist_raw]
            snapshot_hash = str(body["snapshotHash"])
            issued_at_epoch_s = _epoch_seconds(str(body["issuedAt"]))
            expires_at_epoch_s = _epoch_seconds(str(body["expiresAt"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise SnapshotError("malformed entitlement snapshot") from exc

        recomputed = compute_snapshot_hash(
            owner_subject=owner_subject,
            roles=roles,
            permissions=permissions,
            capability_allowlist=capability_allowlist,
            issued_at_epoch_s=issued_at_epoch_s,
            expires_at_epoch_s=expires_at_epoch_s,
        )
        if recomputed != snapshot_hash:
            raise SnapshotError("snapshot failed integrity verification")

        current = now or datetime.now(UTC)
        if current.timestamp() >= expires_at_epoch_s:
            raise SnapshotError("entitlement snapshot has expired")

        return VerifiedSnapshot(
            run_id=str(body.get("runId", "")),
            owner_subject=owner_subject,
            roles=tuple(roles),
            permissions=frozenset(permissions),
            capability_allowlist=frozenset(capability_allowlist),
            expires_at=datetime.fromtimestamp(expires_at_epoch_s, tz=UTC),
        )
