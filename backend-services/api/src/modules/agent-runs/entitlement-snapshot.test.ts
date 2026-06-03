import { permissionsForRoles, type Permission } from '@nova/shared';
import { buildEntitlementSnapshot, computeSnapshotHash } from './entitlement-snapshot';
import { getActiveRegistry } from '../../rbac/registry-holder';

/** Resolve capability ids via the default (static catalog) registry. */
const resolveCapabilityAllowlist = (permissions: ReadonlySet<string>): readonly string[] =>
  getActiveRegistry().capabilityAllowlist(permissions);

/**
 * Cross-language integrity contract. The Python worker recomputes this exact
 * hash; the vector below MUST match the one asserted in the Python parity test
 * (`agents/orchestrator/tests/test_snapshot_parity.py`).
 */
const PARITY_VECTOR = {
  ownerSubject: 'kc-sub-123',
  roles: ['sales-user'],
  permissions: ['read-customers', 'read-sales', 'write-sales'],
  capabilityAllowlist: ['sales.create', 'sales.report.customer'],
  issuedAtEpochS: 1700000000,
  expiresAtEpochS: 1700007200,
};
const PARITY_HASH = 'sha256:c71217485e76b92d4f0d2570de1f1b41fb7ab4ff9a5bfeb546953fa87f12b345';

describe('computeSnapshotHash', () => {
  it('produces the pinned cross-language hash vector', () => {
    expect(computeSnapshotHash(PARITY_VECTOR)).toBe(PARITY_HASH);
  });

  it('is order-independent for roles/permissions/capabilities', () => {
    const shuffled = computeSnapshotHash({
      ...PARITY_VECTOR,
      roles: [...PARITY_VECTOR.roles].reverse(),
      permissions: ['write-sales', 'read-sales', 'read-customers'],
      capabilityAllowlist: ['sales.report.customer', 'sales.create'],
    });
    expect(shuffled).toBe(PARITY_HASH);
  });

  it('changes when any field changes (tamper-evident)', () => {
    expect(computeSnapshotHash({ ...PARITY_VECTOR, ownerSubject: 'kc-sub-999' })).not.toBe(
      PARITY_HASH,
    );
    expect(computeSnapshotHash({ ...PARITY_VECTOR, expiresAtEpochS: 1700007201 })).not.toBe(
      PARITY_HASH,
    );
  });
});

describe('buildEntitlementSnapshot', () => {
  const now = new Date('2026-05-31T00:00:00.000Z');

  it('derives the capability allowlist from the permission set (default deny)', () => {
    const permissions = permissionsForRoles(['customer-support']);
    const snapshot = buildEntitlementSnapshot({
      ownerSubject: 'kc-sub-1',
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      roles: ['customer-support'],
      permissions,
      resolveCapabilityAllowlist,
      ttlSeconds: 7200,
      now,
    });

    // customer-support can read but not create sales.
    expect(snapshot.capabilityAllowlist).toContain('sales.report.customer');
    expect(snapshot.capabilityAllowlist).not.toContain('sales.create');
  });

  it('bounds the run with issuedAt/expiresAt at second precision', () => {
    const snapshot = buildEntitlementSnapshot({
      ownerSubject: 'kc-sub-1',
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      roles: ['sales-user'],
      permissions: new Set<Permission>(['read-sales']),
      resolveCapabilityAllowlist,
      ttlSeconds: 3600,
      now,
    });
    expect(snapshot.expiresAt.getTime() - snapshot.issuedAt.getTime()).toBe(3600 * 1000);
    expect(snapshot.issuedAt.getTime() % 1000).toBe(0);
  });

  it('recomputes to a stable, verifiable hash', () => {
    const input = {
      ownerSubject: 'kc-sub-7',
      ownerUserId: '22222222-2222-2222-2222-222222222222',
      roles: ['sales-user'] as const,
      permissions: permissionsForRoles(['sales-user']),
      resolveCapabilityAllowlist,
      ttlSeconds: 7200,
      now,
    };
    const snapshot = buildEntitlementSnapshot(input);
    const recomputed = computeSnapshotHash({
      ownerSubject: snapshot.ownerSubject,
      roles: snapshot.roles,
      permissions: snapshot.permissions,
      capabilityAllowlist: snapshot.capabilityAllowlist,
      issuedAtEpochS: Math.floor(snapshot.issuedAt.getTime() / 1000),
      expiresAtEpochS: Math.floor(snapshot.expiresAt.getTime() / 1000),
    });
    expect(recomputed).toBe(snapshot.snapshotHash);
  });
});
