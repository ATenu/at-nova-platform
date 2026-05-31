import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  permissionsForRoles,
  rolesGrantPermission,
  toKnownRoles,
} from './permissions';

describe('RBAC definitions', () => {
  it('exposes the expected counts', () => {
    expect(ROLES).toHaveLength(5);
    expect(PERMISSIONS).toHaveLength(19);
  });

  it('maps roles to permissions with the documented totals (57 grants)', () => {
    const totalGrants = Object.values(ROLE_PERMISSIONS).reduce(
      (sum, perms) => sum + perms.length,
      0,
    );
    // 54 prior grants + `read-data` granted to admin, support-operations-user,
    // and ops-compliance (the data-layer roles).
    expect(totalGrants).toBe(57);
    expect(ROLE_PERMISSIONS['admin']).toHaveLength(19);
    expect(ROLE_PERMISSIONS['support-operations-user']).toHaveLength(12);
    expect(ROLE_PERMISSIONS['sales-user']).toHaveLength(10);
    expect(ROLE_PERMISSIONS['customer-support']).toHaveLength(10);
    expect(ROLE_PERMISSIONS['ops-compliance']).toHaveLength(6);
  });

  it('grants read-data only to the data-layer roles (default deny)', () => {
    expect(rolesGrantPermission(['admin'], 'read-data')).toBe(true);
    expect(rolesGrantPermission(['support-operations-user'], 'read-data')).toBe(true);
    expect(rolesGrantPermission(['ops-compliance'], 'read-data')).toBe(true);
    expect(rolesGrantPermission(['sales-user'], 'read-data')).toBe(false);
    expect(rolesGrantPermission(['customer-support'], 'read-data')).toBe(false);
  });

  it('grants the agent-run lifecycle permissions to every assistant-using role', () => {
    for (const role of ROLES) {
      expect(rolesGrantPermission([role], 'create-agent-run')).toBe(true);
      expect(rolesGrantPermission([role], 'read-agent-run')).toBe(true);
      expect(rolesGrantPermission([role], 'cancel-agent-run')).toBe(true);
    }
  });

  it('only grants permissions that are defined', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of perms) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('rolesGrantPermission is default-deny', () => {
    expect(rolesGrantPermission(['sales-user'], 'read-customers')).toBe(true);
    expect(rolesGrantPermission(['sales-user'], 'write-users')).toBe(false);
    expect(rolesGrantPermission([], 'read-customers')).toBe(false);
  });

  it('admin can do everything', () => {
    const adminPermissions = permissionsForRoles(['admin']);
    expect(adminPermissions.size).toBe(PERMISSIONS.length);
  });

  it('toKnownRoles drops unknown roles', () => {
    expect(toKnownRoles(['admin', 'offline_access', 'sales-user'])).toEqual([
      'admin',
      'sales-user',
    ]);
  });
});
