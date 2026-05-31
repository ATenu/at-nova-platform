import { createHash } from 'node:crypto';
import { capabilitiesForPermissions, type Permission, type Role } from '@nova/shared';

/**
 * Immutable authorization snapshot captured at the API edge (the only place the
 * user's token exists). The execution plane authorizes from this snapshot, never
 * from fields trusted off the wire, and `expiresAt` bounds how long an async run
 * may keep acting for the user.
 *
 * The snapshot hash is a CROSS-LANGUAGE integrity contract: the Python worker
 * recomputes the identical hash before every hop and fails closed on any
 * mismatch. The canonical form below MUST stay byte-identical to the Python
 * implementation in `nova_orchestrator.authz.snapshot`:
 *
 *   - fixed key order: ownerSubject, roles, permissions, capabilityAllowlist,
 *     issuedAtEpochS, expiresAtEpochS
 *   - roles / permissions / capabilityAllowlist sorted ascending, de-duplicated
 *   - timestamps as integer epoch SECONDS (no sub-second precision)
 *   - compact JSON separators (",", ":"), UTF-8, then sha256 hex, "sha256:" prefix
 */
export interface EntitlementSnapshot {
  readonly ownerSubject: string;
  readonly ownerUserId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly snapshotHash: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface BuildEntitlementSnapshotInput {
  readonly ownerSubject: string;
  readonly ownerUserId: string;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
  readonly ttlSeconds: number;
  /** Injectable for deterministic tests. */
  readonly now?: Date;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Compute the canonical snapshot hash. Exported for parity testing. */
export function computeSnapshotHash(payload: {
  readonly ownerSubject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly issuedAtEpochS: number;
  readonly expiresAtEpochS: number;
}): string {
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

/**
 * Build the entitlement snapshot from the validated AuthContext's roles and
 * derived permissions. Capabilities are resolved from the permission set via the
 * shared catalog (default deny). Timestamps are truncated to whole seconds so
 * the hash is reproducible across languages.
 */
export function buildEntitlementSnapshot(input: BuildEntitlementSnapshotInput): EntitlementSnapshot {
  const now = input.now ?? new Date();
  const issuedAtEpochS = Math.floor(now.getTime() / 1000);
  const expiresAtEpochS = issuedAtEpochS + input.ttlSeconds;

  const roles = sortedUnique([...input.roles]);
  const permissions = sortedUnique([...input.permissions]);
  const capabilityAllowlist = sortedUnique(
    capabilitiesForPermissions(input.permissions).map((capability) => capability.id),
  );

  const snapshotHash = computeSnapshotHash({
    ownerSubject: input.ownerSubject,
    roles,
    permissions,
    capabilityAllowlist,
    issuedAtEpochS,
    expiresAtEpochS,
  });

  return {
    ownerSubject: input.ownerSubject,
    ownerUserId: input.ownerUserId,
    roles,
    permissions,
    capabilityAllowlist,
    snapshotHash,
    issuedAt: new Date(issuedAtEpochS * 1000),
    expiresAt: new Date(expiresAtEpochS * 1000),
  };
}
