import { describe, expect, it } from 'vitest';
import {
  EXPECTED_ROLE_PERMISSION_COUNT,
  hasAnyPermission,
  hasPermission,
  hasRole,
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

  it('checks roles', () => {
    expect(hasRole(supportOps, 'support-operations-user')).toBe(true);
    expect(hasRole(supportOps, 'admin')).toBe(false);
  });

  it('matches the documented clean-seed grant count', () => {
    expect(EXPECTED_ROLE_PERMISSION_COUNT).toBe(39);
  });

  it('does not grant create-issues to support operations (cannot create issues)', () => {
    expect(supportOps.permissions).not.toContain('create-issues');
  });
});
