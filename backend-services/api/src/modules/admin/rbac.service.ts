import { getActiveRegistry } from '../../rbac/registry-holder';
import type { CapabilityView, RoutePolicyView, ViewPermissionView } from '../../rbac/rbac-registry';

export interface RoleDto {
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
}

export interface PermissionDto {
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
}

export interface RolePermissionMatrixDto {
  readonly roles: readonly RoleDto[];
  readonly permissions: readonly PermissionDto[];
  readonly grants: Record<string, readonly string[]>;
  readonly totalGrants: number;
}

/**
 * Read-only RBAC view. Reflects the authoritative, admin-editable policy held in
 * the DB-driven registry (the same snapshot the authorization layer enforces), so
 * the admin UI can never display a matrix that diverges from what is enforced.
 */
export class RbacService {
  listRoles(): Promise<readonly RoleDto[]> {
    return Promise.resolve(
      getActiveRegistry().snapshot.roles.map((role) => ({
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      })),
    );
  }

  listPermissions(): Promise<readonly PermissionDto[]> {
    return Promise.resolve(
      getActiveRegistry().snapshot.permissions.map((permission) => ({
        name: permission.name,
        description: permission.description,
        isSystem: permission.isSystem,
      })),
    );
  }

  listCapabilities(): Promise<readonly CapabilityView[]> {
    return Promise.resolve(getActiveRegistry().snapshot.capabilities);
  }

  listRoutePolicies(): Promise<readonly RoutePolicyView[]> {
    return Promise.resolve(getActiveRegistry().snapshot.routePolicies);
  }

  listViewPermissions(): Promise<readonly ViewPermissionView[]> {
    return Promise.resolve(getActiveRegistry().snapshot.viewPermissions);
  }

  async getMatrix(): Promise<RolePermissionMatrixDto> {
    const snapshot = getActiveRegistry().snapshot;
    const grants: Record<string, readonly string[]> = {};
    let totalGrants = 0;
    for (const role of snapshot.roles) {
      const granted = snapshot.rolePermissions[role.name] ?? [];
      grants[role.name] = [...granted];
      totalGrants += granted.length;
    }
    return {
      roles: await this.listRoles(),
      permissions: await this.listPermissions(),
      grants,
      totalGrants,
    };
  }
}
