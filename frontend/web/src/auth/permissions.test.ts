import { describe, expect, it } from 'vitest';
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasRole,
  permissionLabel,
  roleLabel,
  type CurrentUser,
} from './permissions';

const supportOps: CurrentUser = {
  id: 'u1',
  email: 'opsman@test.com',
  firstName: 'ope',
  lastName: 'man',
  roles: ['support-operations-user'],
  permissions: ['read-issues', 'write-issues', 'read-actions', 'write-actions', 'read-customers'],
};

describe('authorization helpers', () => {
  it('checks a single permission', () => {
    expect(hasPermission(supportOps, 'write-actions')).toBe(true);
    expect(hasPermission(supportOps, 'create-issues')).toBe(false);
    expect(hasPermission(null, 'read-issues')).toBe(false);
  });

  it('checks any-of permissions', () => {
    expect(hasAnyPermission(supportOps, ['create-issues', 'write-issues'])).toBe(true);
    expect(hasAnyPermission(supportOps, ['write-sop', 'read-users'])).toBe(false);
  });

  it('checks all-of permissions', () => {
    expect(hasAllPermissions(supportOps, ['read-issues', 'write-issues'])).toBe(true);
    expect(hasAllPermissions(supportOps, ['read-issues', 'create-issues'])).toBe(false);
  });

  it('checks roles', () => {
    expect(hasRole(supportOps, 'support-operations-user')).toBe(true);
    expect(hasRole(supportOps, 'admin')).toBe(false);
  });

  it('treats permissions as open strings validated at runtime', () => {
    const user: CurrentUser = { ...supportOps, permissions: ['custom-dynamic-permission'] };
    expect(hasPermission(user, 'custom-dynamic-permission')).toBe(true);
  });

  it('humanizes role and permission names for display', () => {
    expect(permissionLabel('read-customers')).toBe('Read customers');
    expect(roleLabel('ops-compliance')).toBe('Ops Compliance');
  });
});
