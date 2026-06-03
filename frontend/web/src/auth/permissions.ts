/**
 * Frontend authorization helpers. These drive UI affordances (route visibility,
 * button enablement) ONLY — they are never a security boundary. The backend
 * validates every request and remains the single source of truth.
 *
 * Roles and permissions are open strings because the catalog is fully
 * admin-authorable at runtime and served dynamically (see `RbacRegistryProvider`
 * and `/auth/me`). There is intentionally no hardcoded role/permission mirror.
 */

/** A permission name. Validated at runtime against the fetched registry. */
export type NovaPermission = string;

/** A role name. Validated at runtime against the fetched registry. */
export type NovaRole = string;

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
