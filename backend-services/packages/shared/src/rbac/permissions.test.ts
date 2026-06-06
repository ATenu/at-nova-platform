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
    // `read-data` was removed: data access is now governed per-view by domain
    // permissions (see `data-views.ts`), not a coarse SQL gate. `read-agents` /
    // `write-agents` (A2A agent-registry administration) were added (admin-only).
    expect(PERMISSIONS).toHaveLength(20);
  });

  it('maps roles to permissions with the documented totals (56 grants)', () => {
    const totalGrants = Object.values(ROLE_PERMISSIONS).reduce(
      (sum, perms) => sum + perms.length,
      0,
    );
    // 54 prior grants plus the two admin-only agent-registry permissions
    // (`read-agents`, `write-agents`) = 56.
    expect(totalGrants).toBe(56);
    expect(ROLE_PERMISSIONS['admin']).toHaveLength(20);
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
