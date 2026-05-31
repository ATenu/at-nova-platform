import {
  CAPABILITY_CATALOG,
  capabilitiesForPermissions,
  capabilityRequiresApproval,
  getCapability,
  permissionsSatisfyCapability,
  rolesGrantCapability,
} from './capabilities';
import { PERMISSIONS, permissionsForRoles, type Permission } from './permissions';

describe('capability catalog', () => {
  it('only references defined domain permissions', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const capability of CAPABILITY_CATALOG) {
      expect(capability.requiredPermissions.length).toBeGreaterThan(0);
      for (const permission of capability.requiredPermissions) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('has unique capability ids', () => {
    const ids = CAPABILITY_CATALOG.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getCapability denies unknown ids (default deny)', () => {
    expect(getCapability('does.not.exist')).toBeUndefined();
    expect(getCapability('sales.create')).toBeDefined();
  });

  it('AND-composes required permissions', () => {
    const report = getCapability('sales.report.customer');
    expect(report).toBeDefined();
    const onlySales = new Set<Permission>(['read-sales']);
    const both = new Set<Permission>(['read-sales', 'read-customers']);
    expect(permissionsSatisfyCapability(report!, onlySales)).toBe(false);
    expect(permissionsSatisfyCapability(report!, both)).toBe(true);
  });

  it('down-scopes write capabilities for read-only users', () => {
    // customer-support can read sales but cannot write them.
    const permissions = permissionsForRoles(['customer-support']);
    const allowed = capabilitiesForPermissions(permissions).map((capability) => capability.id);
    expect(allowed).toContain('sales.report.customer');
    expect(allowed).not.toContain('sales.create');
  });

  it('matches the documented per-role capability matrix', () => {
    expect(rolesGrantCapability(['sales-user'], 'sales.create')).toBe(true);
    expect(rolesGrantCapability(['support-operations-user'], 'sales.create')).toBe(false);
    expect(rolesGrantCapability(['customer-support'], 'sales.create')).toBe(false);
    expect(rolesGrantCapability(['ops-compliance'], 'sales.create')).toBe(false);

    expect(rolesGrantCapability(['sales-user'], 'actions.markCompleted')).toBe(false);
    expect(rolesGrantCapability(['support-operations-user'], 'actions.markCompleted')).toBe(true);
    expect(rolesGrantCapability(['customer-support'], 'actions.markCompleted')).toBe(true);

    expect(rolesGrantCapability(['ops-compliance'], 'sop.read')).toBe(true);
    expect(rolesGrantCapability(['ops-compliance'], 'sales.report.customer')).toBe(false);
  });

  it('rolesGrantCapability denies unknown capabilities', () => {
    expect(rolesGrantCapability(['admin'], 'unknown.capability')).toBe(false);
  });

  it('flags only high-risk capabilities for approval', () => {
    for (const capability of CAPABILITY_CATALOG) {
      expect(capabilityRequiresApproval(capability)).toBe(capability.risk === 'high');
    }
  });

  it('gates the data-layer capabilities on read-data only', () => {
    for (const id of ['data.schema.describe', 'data.query.select', 'data.analyse.read']) {
      const capability = getCapability(id);
      expect(capability).toBeDefined();
      expect(capability!.requiredPermissions).toEqual(['read-data']);
      expect(capability!.risk).toBe('low');
    }
    // Only read-data holders see the data capabilities (Layer A filtering).
    const dataUser = new Set<Permission>(['read-data']);
    const allowed = capabilitiesForPermissions(dataUser).map((capability) => capability.id);
    expect(allowed).toEqual(
      expect.arrayContaining([
        'data.schema.describe',
        'data.query.select',
        'data.analyse.read',
        'data.act.write',
      ]),
    );
    const noData = new Set<Permission>(['read-sales']);
    expect(capabilitiesForPermissions(noData).map((c) => c.id)).not.toContain('data.query.select');
  });

  it('treats data.act.write as a high-risk dispatch skill (no standalone write permission)', () => {
    const dispatch = getCapability('data.act.write');
    expect(dispatch).toBeDefined();
    expect(dispatch!.mode).toBe('write');
    expect(dispatch!.risk).toBe('high');
    // It never carries a write permission; concrete writes stay gated on their
    // own permission + approval, so the agent cannot mint new write authority.
    expect(dispatch!.requiredPermissions).toEqual(['read-data']);
    expect(capabilityRequiresApproval(dispatch!)).toBe(true);
  });
});
