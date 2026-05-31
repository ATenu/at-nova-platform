import { createHash } from 'node:crypto';

/**
 * Canonical entitlement-snapshot hash — the CROSS-LANGUAGE integrity contract.
 *
 * Every plane that re-enforces authorization (Node API, DB MCP server, the
 * Python worker, the Python agent) recomputes this identical hash and fails
 * closed on any mismatch. The canonical form MUST stay byte-identical to the
 * Python implementation in `nova_orchestrator.authz.snapshot`:
 *
 *   - fixed key order: ownerSubject, roles, permissions, capabilityAllowlist,
 *     issuedAtEpochS, expiresAtEpochS
 *   - roles / permissions / capabilityAllowlist sorted ascending, de-duplicated
 *   - timestamps as integer epoch SECONDS (no sub-second precision)
 *   - compact JSON separators (",", ":"), UTF-8, then sha256 hex, "sha256:" prefix
 *
 * Owning this in one place (`@nova/shared`) keeps the single TypeScript
 * canonicalizer reused by the API and the MCP server rather than duplicated.
 */
export interface SnapshotHashPayload {
  readonly ownerSubject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly issuedAtEpochS: number;
  readonly expiresAtEpochS: number;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function computeSnapshotHash(payload: SnapshotHashPayload): string {
  const canonical = JSON.stringify({
    ownerSubject: payload.ownerSubject,
    roles: sortedUnique(payload.roles),
    permissions: sortedUnique(payload.permissions),
    capabilityAllowlist: sortedUnique(payload.capabilityAllowlist),
    issuedAtEpochS: payload.issuedAtEpochS,
    expiresAtEpochS: payload.expiresAtEpochS,
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
