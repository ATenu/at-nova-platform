/**
 * Centralized, typed RBAC definitions.
 *
 * This module is the single source of truth for the platform's roles,
 * permissions, and the mapping between them. Both the runtime authorization
 * pipeline (API) and the database seed consume these definitions, so the data
 * stored in PostgreSQL can never drift from the access decisions enforced at
 * runtime. Never inline raw role/permission strings in feature code.
 */

export const PERMISSIONS = [
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

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'sales-user',
  'support-operations-user',
  'admin',
  'customer-support',
  'ops-compliance',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Canonical role -> permission grants. This is the authoritative mapping used
 * by both authorization and seeding.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
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
} as const;

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);
const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/** Keep only the values that are known platform roles. */
export function toKnownRoles(values: readonly string[]): Role[] {
  return values.filter(isRole);
}

/** Resolve the flattened, de-duplicated permission set granted by the roles. */
export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }
  return granted;
}

/** True when at least one of the roles grants the required permission. */
export function rolesGrantPermission(roles: readonly Role[], required: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(required));
}
