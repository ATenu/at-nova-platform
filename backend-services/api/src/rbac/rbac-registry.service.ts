import {
  Capability,
  CapabilityPermission,
  Permission as PermissionEntity,
  RbacRevision,
  Role as RoleEntity,
  RolePermission,
  RoutePolicy,
  ViewPermission,
} from '@nova/database';
import type { Logger } from '@nova/shared';
import type { DataSource } from 'typeorm';
import {
  RbacRegistry,
  type CapabilityView,
  type RbacRegistryData,
  type RoutePolicyKind,
  type ViewMode,
} from './rbac-registry';
import { setActiveRegistry } from './registry-holder';

/** Cross-instance invalidation poll interval. Local mutations refresh immediately. */
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export interface RbacRegistryServiceOptions {
  readonly pollIntervalMs?: number;
}

/**
 * Loads the authorization policy from PostgreSQL into an immutable in-memory
 * {@link RbacRegistry}, publishes it to the process-wide holder, and keeps it
 * fresh. Freshness uses the single-row `rbac_revision` marker: the instance that
 * mutates policy refreshes immediately; other instances poll the revision on a
 * short interval and reload only when it changes (cheap single-row read). A
 * failed refresh keeps the last good snapshot (never fails open).
 */
export class RbacRegistryService {
  private current: RbacRegistry = RbacRegistry.fromStaticCatalog();
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
    options: RbacRegistryServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  getCurrent(): RbacRegistry {
    return this.current;
  }

  /** Initial load (must succeed at boot) plus background revision polling. */
  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.pollForChanges();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Reload the snapshot from the database and publish it. */
  async refresh(): Promise<RbacRegistry> {
    const data = await this.loadData();
    this.current = new RbacRegistry(data);
    setActiveRegistry(this.current);
    return this.current;
  }

  private async pollForChanges(): Promise<void> {
    try {
      const revision = await this.readRevision();
      if (revision !== this.current.revision) {
        await this.refresh();
        this.logger.info({ revision }, 'rbac registry refreshed from revision change');
      }
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'rbac registry refresh poll failed; keeping last known policy',
      );
    }
  }

  private async readRevision(): Promise<number> {
    const row = await this.dataSource.getRepository(RbacRevision).findOneBy({ id: 1 });
    return row ? Number.parseInt(row.revision, 10) : 0;
  }

  private async loadData(): Promise<RbacRegistryData> {
    const [roles, permissions, rolePermissionRows, capabilities, capabilityPermissionRows, routePolicies, viewPermissions, revision] =
      await Promise.all([
        this.dataSource.getRepository(RoleEntity).find(),
        this.dataSource.getRepository(PermissionEntity).find(),
        this.dataSource.getRepository(RolePermission).find(),
        this.dataSource.getRepository(Capability).find(),
        this.dataSource.getRepository(CapabilityPermission).find(),
        this.dataSource.getRepository(RoutePolicy).find(),
        this.dataSource.getRepository(ViewPermission).find(),
        this.readRevision(),
      ]);

    const rolePermissions: Record<string, string[]> = {};
    for (const role of roles) {
      rolePermissions[role.name] = [];
    }
    for (const row of rolePermissionRows) {
      (rolePermissions[row.roleName] ??= []).push(row.permissionName);
    }

    const requiredByCapability = new Map<string, string[]>();
    for (const row of capabilityPermissionRows) {
      const list = requiredByCapability.get(row.capabilityId) ?? [];
      list.push(row.permissionName);
      requiredByCapability.set(row.capabilityId, list);
    }

    const capabilityViews: CapabilityView[] = capabilities.map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      mode: capability.mode,
      risk: capability.risk === 'high' ? 'high' : 'low',
      resourceScoped: capability.resourceScoped,
      delegated: capability.delegated,
      enabled: capability.enabled,
      requiresApproval: capability.requiresApproval,
      isSystem: capability.isSystem,
      requiredPermissions: requiredByCapability.get(capability.id) ?? [],
    }));

    return {
      revision,
      roles: roles.map((role) => ({
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        keycloakRoleId: role.keycloakRoleId,
      })),
      permissions: permissions.map((permission) => ({
        name: permission.name,
        description: permission.description,
        isSystem: permission.isSystem,
      })),
      rolePermissions,
      capabilities: capabilityViews,
      routePolicies: routePolicies.map((policy) => ({
        routeId: policy.routeId,
        kind: policy.kind as RoutePolicyKind,
        permissionName: policy.permissionName,
        audit: policy.audit,
      })),
      viewPermissions: viewPermissions.map((view) => ({
        viewName: view.viewName,
        mode: view.mode as ViewMode,
        permissionName: view.permissionName,
      })),
    };
  }
}
