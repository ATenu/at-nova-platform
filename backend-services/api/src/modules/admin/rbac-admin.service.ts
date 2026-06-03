import {
  Capability,
  CapabilityPermission,
  Permission as PermissionEntity,
  RbacAuditLog,
  Role as RoleEntity,
  RolePermission,
  RoutePolicy,
  UserRole,
  ViewPermission,
} from '@nova/database';
import { ConflictError, NotFoundError, ValidationError, type Logger } from '@nova/shared';
import type { DataSource, EntityManager } from 'typeorm';
import type { RbacRegistryData } from '../../rbac/rbac-registry';
import type { RbacRegistryService } from '../../rbac/rbac-registry.service';
import type {
  KeycloakProvisioningService,
  RealmRoleSyncResult,
} from './keycloak-provisioning.service';
import type {
  CreateCapabilityBody,
  CreatePermissionBody,
  CreateRoleBody,
  UpdateCapabilityBody,
  UpdateRoutePolicyBody,
} from './rbac-admin.schema';

/**
 * Permissions whose removal would lock administrators out of the platform's
 * RBAC and user-management surface. The service refuses any mutation that would
 * leave one of these granted to no role (last-admin protection).
 */
const CRITICAL_PERMISSIONS = [
  'read-permissions',
  'write-permissions',
  'read-users',
  'write-users',
] as const;

export interface RbacActor {
  readonly subject: string;
  readonly userId: string | null;
}

export interface RbacWriteResult {
  readonly registry: RbacRegistryData;
  readonly keycloak: RealmRoleSyncResult | null;
}

interface AuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Authoritative, audited RBAC mutation surface. All policy changes (roles,
 * permissions, role->permission grants, capabilities, route bindings, view
 * bindings) run in a transaction that also bumps the revision marker and records
 * an audit entry; the in-memory registry is refreshed and a Postgres NOTIFY is
 * emitted afterwards so every instance converges. Role lifecycle changes are
 * mirrored to Keycloak realm roles. Default deny and last-admin protection are
 * enforced here, never in controllers.
 */
export class RbacAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registryService: RbacRegistryService,
    private readonly provisioning: KeycloakProvisioningService,
    private readonly logger: Logger,
  ) {}

  // --- Roles ---------------------------------------------------------------

  async createRole(actor: RbacActor, body: CreateRoleBody): Promise<RbacWriteResult> {
    await this.mutate(actor, async (manager) => {
      const existing = await manager.getRepository(RoleEntity).findOneBy({ name: body.name });
      if (existing) {
        throw new ConflictError('A role with this name already exists.');
      }
      await manager.getRepository(RoleEntity).insert({
        name: body.name,
        description: body.description ?? null,
        isSystem: false,
        keycloakRoleId: null,
      });
      return { action: 'role.create', targetType: 'role', targetId: body.name };
    });

    const keycloak = await this.provisioning.ensureRealmRole(body.name, body.description ?? null);
    if (keycloak.keycloakRoleId) {
      await this.dataSource
        .getRepository(RoleEntity)
        .update({ name: body.name }, { keycloakRoleId: keycloak.keycloakRoleId });
      await this.registryService.refresh();
    }
    return { registry: this.registryService.getCurrent().snapshot, keycloak };
  }

  async updateRole(actor: RbacActor, name: string, description: string | null): Promise<RbacWriteResult> {
    await this.mutate(actor, async (manager) => {
      await this.requireRole(manager, name);
      await manager.getRepository(RoleEntity).update({ name }, { description });
      return { action: 'role.update', targetType: 'role', targetId: name, details: { description } };
    });
    const keycloak = await this.provisioning.updateRealmRole(name, description);
    return { registry: this.registryService.getCurrent().snapshot, keycloak };
  }

  async deleteRole(actor: RbacActor, name: string): Promise<RbacWriteResult> {
    await this.mutate(actor, async (manager) => {
      const role = await this.requireRole(manager, name);
      if (role.isSystem) {
        throw new ConflictError('Built-in roles cannot be deleted.');
      }
      const assignments = await manager.getRepository(UserRole).countBy({ roleName: name });
      if (assignments > 0) {
        throw new ConflictError('Reassign or remove this role from all users before deleting it.');
      }
      await manager.getRepository(RoleEntity).delete({ name });
      return { action: 'role.delete', targetType: 'role', targetId: name };
    });
    const keycloak = await this.provisioning.deleteRealmRole(name);
    return { registry: this.registryService.getCurrent().snapshot, keycloak };
  }

  // --- Permissions ---------------------------------------------------------

  async createPermission(actor: RbacActor, body: CreatePermissionBody): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const existing = await manager.getRepository(PermissionEntity).findOneBy({ name: body.name });
      if (existing) {
        throw new ConflictError('A permission with this name already exists.');
      }
      await manager
        .getRepository(PermissionEntity)
        .insert({ name: body.name, description: body.description ?? null, isSystem: false });
      return { action: 'permission.create', targetType: 'permission', targetId: body.name };
    });
    return { registry, keycloak: null };
  }

  async updatePermission(
    actor: RbacActor,
    name: string,
    descriptionValue: string | null,
  ): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      await this.requirePermission(manager, name);
      await manager.getRepository(PermissionEntity).update({ name }, { description: descriptionValue });
      return { action: 'permission.update', targetType: 'permission', targetId: name };
    });
    return { registry, keycloak: null };
  }

  async deletePermission(actor: RbacActor, name: string): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const permission = await this.requirePermission(manager, name);
      if (permission.isSystem) {
        throw new ConflictError('Built-in permissions cannot be deleted.');
      }
      const routeRefs = await manager.getRepository(RoutePolicy).countBy({ permissionName: name });
      const viewRefs = await manager.getRepository(ViewPermission).countBy({ permissionName: name });
      if (routeRefs > 0 || viewRefs > 0) {
        throw new ConflictError('Rebind the routes/views that require this permission before deleting it.');
      }
      // role_permissions and capability_permissions cascade on delete.
      await manager.getRepository(PermissionEntity).delete({ name });
      return { action: 'permission.delete', targetType: 'permission', targetId: name };
    });
    return { registry, keycloak: null };
  }

  // --- Role -> permission grants ------------------------------------------

  async setRolePermissions(
    actor: RbacActor,
    roleName: string,
    permissions: readonly string[],
  ): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      await this.requireRole(manager, roleName);
      await this.requirePermissionsExist(manager, permissions);
      await manager.getRepository(RolePermission).delete({ roleName });
      if (permissions.length > 0) {
        await manager
          .getRepository(RolePermission)
          .insert(permissions.map((permissionName) => ({ roleName, permissionName })));
      }
      return {
        action: 'role-permission.set',
        targetType: 'role',
        targetId: roleName,
        details: { permissions: [...permissions] },
      };
    });
    return { registry, keycloak: null };
  }

  // --- Capabilities --------------------------------------------------------

  async createCapability(actor: RbacActor, body: CreateCapabilityBody): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const existing = await manager.getRepository(Capability).findOneBy({ id: body.id });
      if (existing) {
        throw new ConflictError('A capability with this id already exists.');
      }
      await this.requirePermissionsExist(manager, body.requiredPermissions);
      await manager.getRepository(Capability).insert({
        id: body.id,
        kind: body.kind,
        mode: body.mode,
        risk: body.risk,
        resourceScoped: body.resourceScoped,
        delegated: body.delegated,
        enabled: true,
        requiresApproval: body.requiresApproval,
        isSystem: false,
        description: body.description ?? null,
      });
      await manager
        .getRepository(CapabilityPermission)
        .insert(body.requiredPermissions.map((permissionName) => ({ capabilityId: body.id, permissionName })));
      return { action: 'capability.create', targetType: 'capability', targetId: body.id };
    });
    return { registry, keycloak: null };
  }

  async updateCapability(
    actor: RbacActor,
    id: string,
    body: UpdateCapabilityBody,
  ): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const capability = await manager.getRepository(Capability).findOneBy({ id });
      if (!capability) {
        throw new NotFoundError('Capability not found.');
      }
      const patch: Partial<Capability> = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.risk !== undefined) patch.risk = body.risk;
      if (body.requiresApproval !== undefined) patch.requiresApproval = body.requiresApproval;
      if (body.description !== undefined) patch.description = body.description;
      if (Object.keys(patch).length > 0) {
        await manager.getRepository(Capability).update({ id }, patch);
      }
      if (body.requiredPermissions !== undefined) {
        await this.requirePermissionsExist(manager, body.requiredPermissions);
        await manager.getRepository(CapabilityPermission).delete({ capabilityId: id });
        if (body.requiredPermissions.length > 0) {
          await manager
            .getRepository(CapabilityPermission)
            .insert(
              body.requiredPermissions.map((permissionName) => ({ capabilityId: id, permissionName })),
            );
        }
      }
      return { action: 'capability.update', targetType: 'capability', targetId: id };
    });
    return { registry, keycloak: null };
  }

  async deleteCapability(actor: RbacActor, id: string): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const capability = await manager.getRepository(Capability).findOneBy({ id });
      if (!capability) {
        throw new NotFoundError('Capability not found.');
      }
      if (capability.isSystem) {
        throw new ConflictError('Built-in capabilities cannot be deleted.');
      }
      await manager.getRepository(Capability).delete({ id });
      return { action: 'capability.delete', targetType: 'capability', targetId: id };
    });
    return { registry, keycloak: null };
  }

  // --- Route policies ------------------------------------------------------

  async updateRoutePolicy(
    actor: RbacActor,
    routeId: string,
    body: UpdateRoutePolicyBody,
  ): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      const policy = await manager.getRepository(RoutePolicy).findOneBy({ routeId });
      if (!policy) {
        throw new NotFoundError('Route policy not found.');
      }
      const permissionName = body.kind === 'permission' ? (body.permissionName ?? null) : null;
      if (body.kind === 'permission' && permissionName) {
        await this.requirePermissionsExist(manager, [permissionName]);
      }
      await manager.getRepository(RoutePolicy).update(
        { routeId },
        {
          kind: body.kind,
          permissionName,
          ...(body.audit !== undefined ? { audit: body.audit } : {}),
        },
      );
      return {
        action: 'route-policy.update',
        targetType: 'route',
        targetId: routeId,
        details: { kind: body.kind, permissionName },
      };
    });
    return { registry, keycloak: null };
  }

  // --- View bindings -------------------------------------------------------

  async updateViewPermission(
    actor: RbacActor,
    viewName: string,
    mode: 'read' | 'write',
    permissionName: string,
  ): Promise<RbacWriteResult> {
    const registry = await this.mutate(actor, async (manager) => {
      await this.requirePermissionsExist(manager, [permissionName]);
      await manager
        .getRepository(ViewPermission)
        .upsert({ viewName, mode, permissionName, isSystem: false }, ['viewName', 'mode']);
      return {
        action: 'view-permission.update',
        targetType: 'view',
        targetId: `${viewName}:${mode}`,
        details: { permissionName },
      };
    });
    return { registry, keycloak: null };
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Run a mutation in a transaction, record the audit entry, enforce last-admin
   * protection, bump the revision, then publish the refreshed registry and a
   * cross-instance NOTIFY. Returns the refreshed snapshot.
   */
  private async mutate(
    actor: RbacActor,
    work: (manager: EntityManager) => Promise<AuditEntry>,
  ): Promise<RbacRegistryData> {
    await this.dataSource.transaction(async (manager) => {
      const entry = await work(manager);
      await this.assertCriticalPermissionsCovered(manager);
      await manager.getRepository(RbacAuditLog).insert({
        actorSubject: actor.subject,
        actorUserId: actor.userId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ...(entry.details !== undefined ? { details: entry.details } : {}),
      });
      await manager.query('UPDATE rbac_revision SET revision = revision + 1, updated_at = now() WHERE id = 1');
    });
    await this.notifyChanged();
    const registry = await this.registryService.refresh();
    return registry.snapshot;
  }

  private async notifyChanged(): Promise<void> {
    try {
      await this.dataSource.query("SELECT pg_notify('rbac_changed', '1')");
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'failed to emit rbac_changed notification',
      );
    }
  }

  private async requireRole(manager: EntityManager, name: string): Promise<RoleEntity> {
    const role = await manager.getRepository(RoleEntity).findOneBy({ name });
    if (!role) {
      throw new NotFoundError('Role not found.');
    }
    return role;
  }

  private async requirePermission(manager: EntityManager, name: string): Promise<PermissionEntity> {
    const permission = await manager.getRepository(PermissionEntity).findOneBy({ name });
    if (!permission) {
      throw new NotFoundError('Permission not found.');
    }
    return permission;
  }

  private async requirePermissionsExist(
    manager: EntityManager,
    names: readonly string[],
  ): Promise<void> {
    if (names.length === 0) {
      return;
    }
    const found = await manager
      .getRepository(PermissionEntity)
      .createQueryBuilder('permission')
      .where('permission.name IN (:...names)', { names: [...new Set(names)] })
      .getMany();
    const known = new Set(found.map((permission) => permission.name));
    const missing = names.filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw new ValidationError(`Unknown permission(s): ${[...new Set(missing)].join(', ')}`);
    }
  }

  /**
   * Last-admin protection: after any mutation, every critical permission must
   * still be granted to at least one role; otherwise the change is rolled back.
   */
  private async assertCriticalPermissionsCovered(manager: EntityManager): Promise<void> {
    const rows = await manager
      .getRepository(RolePermission)
      .createQueryBuilder('grant')
      .select('grant.permission_name', 'permissionName')
      .where('grant.permission_name IN (:...names)', { names: [...CRITICAL_PERMISSIONS] })
      .groupBy('grant.permission_name')
      .getRawMany<{ permissionName: string }>();
    const covered = new Set(rows.map((row) => row.permissionName));
    const orphaned = CRITICAL_PERMISSIONS.filter((permission) => !covered.has(permission));
    if (orphaned.length > 0) {
      throw new ValidationError(
        `This change would leave no role with required admin permission(s): ${orphaned.join(', ')}.`,
      );
    }
  }
}
