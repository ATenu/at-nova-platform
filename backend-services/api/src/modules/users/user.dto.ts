import type { User } from '@nova/database';
import { permissionsForRoles, toKnownRoles } from '@nova/shared';

/** Minimal user reference embedded in other resources (owners, authors). */
export interface UserSummaryDto {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The authenticated caller's own profile with effective roles/permissions. */
export interface CurrentUserDto extends Omit<UserSummaryDto, 'createdAt' | 'updatedAt'> {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export type KeycloakSyncStatus = 'synced' | 'partial' | 'not_found' | 'error';

export interface KeycloakStatusDto {
  readonly exists: boolean;
  readonly enabled: boolean;
  readonly syncedRoles: readonly string[];
  readonly syncStatus: KeycloakSyncStatus;
  readonly lastSyncError: string | null;
}

/** Admin-facing user record including role mappings and Keycloak sync state. */
export interface AdminUserDto extends UserSummaryDto {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly keycloak: KeycloakStatusDto;
}

export function toUserSummaryDto(user: User): UserSummaryDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName,
    description: user.description,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function effectivePermissions(roles: readonly string[]): string[] {
  return [...permissionsForRoles(toKnownRoles([...roles]))];
}

export function toCurrentUserDto(user: User, roles: readonly string[]): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName,
    description: user.description,
    roles,
    permissions: effectivePermissions(roles),
  };
}

/**
 * Build the Keycloak sync block from locally known state. `status` overrides the
 * cheap default (used after a real reconciliation against the Admin API).
 */
export function toAdminUserDto(
  user: User,
  roles: readonly string[],
  overrides?: { readonly status?: KeycloakSyncStatus; readonly lastSyncError?: string | null },
): AdminUserDto {
  return {
    ...toUserSummaryDto(user),
    roles,
    permissions: effectivePermissions(roles),
    active: user.active,
    keycloak: {
      exists: user.keycloakId !== null,
      enabled: user.active,
      syncedRoles: roles,
      syncStatus: overrides?.status ?? (user.keycloakId !== null ? 'synced' : 'not_found'),
      lastSyncError: overrides?.lastSyncError ?? null,
    },
  };
}
