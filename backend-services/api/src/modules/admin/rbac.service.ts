import { Permission as PermissionEntity, Role as RoleEntity } from '@nova/database';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@nova/shared';
import type { DataSource, Repository } from 'typeorm';

export interface RoleDto {
  readonly name: string;
  readonly description: string | null;
}

export interface PermissionDto {
  readonly name: string;
  readonly description: string | null;
}

export interface RolePermissionMatrixDto {
  readonly roles: readonly RoleDto[];
  readonly permissions: readonly PermissionDto[];
  readonly grants: Record<string, readonly string[]>;
  readonly totalGrants: number;
}

/**
 * Read-only RBAC view. The authoritative role -> permission grants live in
 * `@nova/shared` (`ROLE_PERMISSIONS`) and are what the authorization pipeline
 * enforces; this service simply reflects them (enriched with the descriptions
 * stored in the database). Runtime grant edits are intentionally not exposed:
 * changing a database row could never alter the enforced policy and would only
 * create a misleading divergence.
 */
export class RbacService {
  private readonly roles: Repository<RoleEntity>;
  private readonly permissions: Repository<PermissionEntity>;

  constructor(dataSource: DataSource) {
    this.roles = dataSource.getRepository(RoleEntity);
    this.permissions = dataSource.getRepository(PermissionEntity);
  }

  async listRoles(): Promise<readonly RoleDto[]> {
    const descriptions = await this.roleDescriptions();
    return ROLES.map((name) => ({ name, description: descriptions.get(name) ?? null }));
  }

  async listPermissions(): Promise<readonly PermissionDto[]> {
    const descriptions = await this.permissionDescriptions();
    return PERMISSIONS.map((name) => ({ name, description: descriptions.get(name) ?? null }));
  }

  async getMatrix(): Promise<RolePermissionMatrixDto> {
    const [roles, permissions] = await Promise.all([this.listRoles(), this.listPermissions()]);
    const grants: Record<string, readonly string[]> = {};
    let totalGrants = 0;
    for (const role of ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      grants[role] = [...granted];
      totalGrants += granted.length;
    }
    return { roles, permissions, grants, totalGrants };
  }

  private async roleDescriptions(): Promise<Map<string, string | null>> {
    const rows = await this.roles.find();
    return new Map(rows.map((row) => [row.name, row.description]));
  }

  private async permissionDescriptions(): Promise<Map<string, string | null>> {
    const rows = await this.permissions.find();
    return new Map(rows.map((row) => [row.name, row.description]));
  }
}
