import {
  getCapability,
  permissionsSatisfyCapability,
  type Permission,
} from '@nova/shared';
import { McpError } from '../errors';
import type { VerifiedSnapshot } from './snapshot-client';

/**
 * The authoritative capability gate (Layer B) for the MCP data tools. Re-checks
 * the snapshot's permission set against the SAME shared catalog the control
 * plane uses, so the data surface can never drift from REST. Default deny:
 * unknown capability or any missing permission is rejected.
 *
 * `capabilityAllowlist` membership (Layer A) is also required as defense in
 * depth — the snapshot pre-computed the allowed set at the edge, and the tool
 * must appear in it.
 */
export function authorizeCapability(snapshot: VerifiedSnapshot, capabilityId: string): void {
  const capability = getCapability(capabilityId);
  if (!capability) {
    throw new McpError('forbidden', 'Unknown capability.');
  }
  const permissions = new Set<Permission>(snapshot.permissions as Permission[]);
  if (!permissionsSatisfyCapability(capability, permissions)) {
    throw new McpError('forbidden', 'Not entitled to this capability.');
  }
  if (!snapshot.capabilityAllowlist.includes(capabilityId)) {
    throw new McpError('forbidden', 'Capability is not in the entitlement allowlist.');
  }
}

/** Layer A helper: is the caller entitled to this capability at all? */
export function isEntitled(snapshot: VerifiedSnapshot, capabilityId: string): boolean {
  const capability = getCapability(capabilityId);
  if (!capability) {
    return false;
  }
  const permissions = new Set<Permission>(snapshot.permissions as Permission[]);
  return (
    permissionsSatisfyCapability(capability, permissions) &&
    snapshot.capabilityAllowlist.includes(capabilityId)
  );
}
