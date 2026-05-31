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
    expect(PERMISSIONS).toHaveLength(18);
  });

  it('maps roles to permissions with the documented totals (54 grants)', () => {
    const totalGrants = Object.values(ROLE_PERMISSIONS).reduce(
      (sum, perms) => sum + perms.length,
      0,
    );
    // 39 domain grants + 3 agent-run lifecycle grants per role (5 roles).
    expect(totalGrants).toBe(54);
    expect(ROLE_PERMISSIONS['admin']).toHaveLength(18);
    expect(ROLE_PERMISSIONS['support-operations-user']).toHaveLength(11);
    expect(ROLE_PERMISSIONS['sales-user']).toHaveLength(10);
    expect(ROLE_PERMISSIONS['customer-support']).toHaveLength(10);
    expect(ROLE_PERMISSIONS['ops-compliance']).toHaveLength(5);
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
