/**
 * Typed RBAC catalog used as the INITIAL SEED and as the fail-closed bootstrap
 * baseline.
 *
 * The runtime source of truth for authorization policy (roles, permissions,
 * role->permission grants, capability bindings) is the database, served via the
 * RBAC registry and editable by an admin. These constants seed that database so
 * day-1 behavior is identical, and provide a safe default the API can bootstrap
 * from before the first DB load. They are NOT the runtime policy: a DB/admin
 * change does alter enforced access. Never inline raw role/permission strings in
 * feature code; reference these names.
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
  // Agent-run lifecycle plumbing (NOT domain actions). These gate the
  // `/api/v1/agent-runs` surface only: opening a run, reading/streaming an
  // owned run, and cancelling an owned run. Granular "can this user do X"
  // decisions are made by binding each agent skill / MCP tool to the SAME
  // domain permission its equivalent REST operation already requires (see
  // `capabilities.ts`), never by these coarse lifecycle gates.
  'create-agent-run',
  'read-agent-run',
  'cancel-agent-run',
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
    'create-agent-run',
    'read-agent-run',
    'cancel-agent-run',
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
    'create-agent-run',
    'read-agent-run',
    'cancel-agent-run',
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
    'create-agent-run',
    'read-agent-run',
    'cancel-agent-run',
  ],
  'ops-compliance': [
    'read-sop',
    'write-sop',
    'create-agent-run',
    'read-agent-run',
    'cancel-agent-run',
  ],
  'customer-support': [
    'read-customers',
    'create-issues',
    'read-issues',
    'write-issues',
    'read-sales',
    'read-actions',
    'write-actions',
    'create-agent-run',
    'read-agent-run',
    'cancel-agent-run',
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
