/**
 * Frontend mirror of the backend RBAC source of truth
 * (`@nova/shared` PERMISSIONS / ROLES / ROLE_PERMISSIONS).
 *
 * These constants exist only to drive UI affordances (route visibility, button
 * enablement). They are NOT an authorization boundary: the backend validates
 * every request and remains the single source of truth. Effective permissions
 * for the current user always come from the backend `/auth/me` response, not
 * from this static map.
 */

export const NOVA_ROLES = [
  'sales-user',
  'support-operations-user',
  'admin',
  'customer-support',
  'ops-compliance',
] as const;

export type NovaRole = (typeof NOVA_ROLES)[number];

export const NOVA_PERMISSIONS = [
  'read-customers',
  'write-customers',
  'create-issues',
  'read-issues',
  'write-issues',
  'read-sales',
  'write-sales',
  'read-permissions',
  'write-permissions',
  'read-actions',
  'write-actions',
  'read-sop',
  'write-sop',
  'read-users',
  'write-users',
] as const;

export type NovaPermission = (typeof NOVA_PERMISSIONS)[number];

/** Canonical role -> permission grants (kept in sync with the backend seed). */
export const ROLE_PERMISSIONS: Readonly<Record<NovaRole, readonly NovaPermission[]>> = {
  'sales-user': [
    'read-customers',
    'write-customers',
    'read-issues',
    'read-sales',
    'write-sales',
    'read-actions',
    'read-sop',
  ],
  'support-operations-user': [
    'read-customers',
    'write-customers',
    'read-issues',
    'write-issues',
    'read-sales',
    'read-actions',
    'write-actions',
    'read-sop',
  ],
  admin: [
    'read-customers',
    'write-customers',
    'create-issues',
    'read-issues',
    'write-issues',
    'read-sales',
    'write-sales',
    'read-permissions',
    'write-permissions',
    'read-actions',
    'write-actions',
    'read-sop',
    'write-sop',
    'read-users',
    'write-users',
  ],
  'ops-compliance': ['read-sop', 'write-sop'],
  'customer-support': [
    'read-customers',
    'create-issues',
    'read-issues',
    'write-issues',
    'read-sales',
    'read-actions',
    'write-actions',
  ],
};

/** Total role_permission grants after a clean seed; used for admin verification UI. */
export const EXPECTED_ROLE_PERMISSION_COUNT = Object.values(ROLE_PERMISSIONS).reduce(
  (sum, permissions) => sum + permissions.length,
  0,
);

const ROLE_SET: ReadonlySet<string> = new Set(NOVA_ROLES);
const PERMISSION_SET: ReadonlySet<string> = new Set(NOVA_PERMISSIONS);

export function isNovaRole(value: string): value is NovaRole {
  return ROLE_SET.has(value);
}

export function isNovaPermission(value: string): value is NovaPermission {
  return PERMISSION_SET.has(value);
}

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export function hasPermission(user: CurrentUser | null, permission: NovaPermission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function hasAnyPermission(
  user: CurrentUser | null,
  permissions: readonly NovaPermission[],
): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function hasAllPermissions(
  user: CurrentUser | null,
  permissions: readonly NovaPermission[],
): boolean {
  return permissions.every((permission) => hasPermission(user, permission));
}

export function hasRole(user: CurrentUser | null, role: NovaRole): boolean {
  return Boolean(user?.roles.includes(role));
}

/** Display label for a permission, e.g. "read-customers" -> "Read customers". */
export function permissionLabel(permission: string): string {
  const spaced = permission.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Display label for a role, e.g. "ops-compliance" -> "Ops Compliance". */
export function roleLabel(role: string): string {
  return role
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
