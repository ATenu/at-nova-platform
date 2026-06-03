import {
  CAPABILITY_CATALOG,
  MCP_READ_VIEW_PERMISSIONS,
  MCP_WRITE_VIEW_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
} from '@nova/shared';

/** Read/write mode for a data view binding. */
export type ViewMode = 'read' | 'write';

export interface RoleView {
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly keycloakRoleId: string | null;
}

export interface PermissionView {
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
}

export interface CapabilityView {
  readonly id: string;
  readonly kind: string;
  readonly mode: string;
  readonly risk: 'low' | 'high';
  readonly resourceScoped: boolean;
  readonly delegated: boolean;
  readonly enabled: boolean;
  /** Opt-in human-approval gate (default false); decoupled from `risk`. */
  readonly requiresApproval: boolean;
  readonly isSystem: boolean;
  readonly requiredPermissions: readonly string[];
}

export type RoutePolicyKind = 'public' | 'authenticated' | 'permission';

export interface RoutePolicyView {
  readonly routeId: string;
  readonly kind: RoutePolicyKind;
  readonly permissionName: string | null;
  readonly audit: boolean;
}

export interface ViewPermissionView {
  readonly viewName: string;
  readonly mode: ViewMode;
  readonly permissionName: string;
}

export interface RbacRegistryData {
  readonly revision: number;
  readonly roles: readonly RoleView[];
  readonly permissions: readonly PermissionView[];
  /** role name -> granted permission names. */
  readonly rolePermissions: Readonly<Record<string, readonly string[]>>;
  readonly capabilities: readonly CapabilityView[];
  readonly routePolicies: readonly RoutePolicyView[];
  readonly viewPermissions: readonly ViewPermissionView[];
}

/**
 * Immutable, query-optimized view over the platform's authorization policy. This
 * is the single in-memory source the enforcement layer consults; it is built
 * from the database (authoritative) and refreshed when the revision changes. A
 * default instance built from the shared catalog provides a safe bootstrap value
 * and identical day-1 behavior before the first database load completes.
 *
 * Authorization is default-deny everywhere:
 * - unknown role grants nothing;
 * - a disabled capability or one with no required permissions is never granted;
 * - an unknown route/view is never implicitly allowed.
 */
export class RbacRegistry {
  private readonly roleSet: ReadonlySet<string>;
  private readonly rolePermissionMap: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly capabilityMap: ReadonlyMap<string, CapabilityView>;
  private readonly routePolicyMap: ReadonlyMap<string, RoutePolicyView>;
  private readonly viewReadMap: ReadonlyMap<string, string>;
  private readonly viewWriteMap: ReadonlyMap<string, string>;

  constructor(private readonly data: RbacRegistryData) {
    this.roleSet = new Set(data.roles.map((role) => role.name));
    this.rolePermissionMap = new Map(
      Object.entries(data.rolePermissions).map(([role, perms]) => [role, new Set(perms)]),
    );
    this.capabilityMap = new Map(data.capabilities.map((capability) => [capability.id, capability]));
    this.routePolicyMap = new Map(data.routePolicies.map((policy) => [policy.routeId, policy]));
    this.viewReadMap = new Map(
      data.viewPermissions
        .filter((view) => view.mode === 'read')
        .map((view) => [view.viewName, view.permissionName]),
    );
    this.viewWriteMap = new Map(
      data.viewPermissions
        .filter((view) => view.mode === 'write')
        .map((view) => [view.viewName, view.permissionName]),
    );
  }

  get revision(): number {
    return this.data.revision;
  }

  /** Raw, serializable policy snapshot (used by the registry endpoint). */
  get snapshot(): RbacRegistryData {
    return this.data;
  }

  hasRole(name: string): boolean {
    return this.roleSet.has(name);
  }

  /** Keep only the values that are roles known to the platform (default deny). */
  knownRoles(values: readonly string[]): string[] {
    return values.filter((value) => this.roleSet.has(value));
  }

  /** Flattened, de-duplicated permission set granted by the given roles. */
  permissionsForRoles(roles: readonly string[]): Set<string> {
    const granted = new Set<string>();
    for (const role of roles) {
      const perms = this.rolePermissionMap.get(role);
      if (perms) {
        for (const permission of perms) {
          granted.add(permission);
        }
      }
    }
    return granted;
  }

  rolesGrantPermission(roles: readonly string[], required: string): boolean {
    return roles.some((role) => this.rolePermissionMap.get(role)?.has(required) === true);
  }

  routePolicy(routeId: string): RoutePolicyView | undefined {
    return this.routePolicyMap.get(routeId);
  }

  getCapability(id: string): CapabilityView | undefined {
    return this.capabilityMap.get(id);
  }

  /**
   * True only when the capability is enabled, declares at least one required
   * permission, and the permission set grants every one of them (AND, default
   * deny).
   */
  permissionsSatisfyCapability(capability: CapabilityView, permissions: ReadonlySet<string>): boolean {
    if (!capability.enabled || capability.requiredPermissions.length === 0) {
      return false;
    }
    return capability.requiredPermissions.every((permission) => permissions.has(permission));
  }

  /** Capability ids the permission set may invoke (the planner/worker allowlist). */
  capabilityAllowlist(permissions: ReadonlySet<string>): string[] {
    return this.data.capabilities
      .filter((capability) => this.permissionsSatisfyCapability(capability, permissions))
      .map((capability) => capability.id);
  }

  permissionForView(view: string, mode: ViewMode): string | undefined {
    return (mode === 'read' ? this.viewReadMap : this.viewWriteMap).get(view);
  }

  accessibleViews(permissions: ReadonlySet<string>): string[] {
    return [...this.viewReadMap.entries()]
      .filter(([, permission]) => permissions.has(permission))
      .map(([view]) => view);
  }

  /**
   * Safe default built from the shared catalog. Used as the bootstrap value
   * before the first database load and in unit tests; it mirrors the seeded
   * baseline so behavior is identical until an admin edits policy in the DB.
   */
  static fromStaticCatalog(): RbacRegistry {
    const rolePermissions: Record<string, readonly string[]> = {};
    for (const role of ROLES) {
      rolePermissions[role] = [...ROLE_PERMISSIONS[role]];
    }
    const viewPermissions: ViewPermissionView[] = [
      ...Object.entries(MCP_READ_VIEW_PERMISSIONS).map(([viewName, permissionName]) => ({
        viewName,
        mode: 'read' as const,
        permissionName,
      })),
      ...Object.entries(MCP_WRITE_VIEW_PERMISSIONS).map(([viewName, permissionName]) => ({
        viewName,
        mode: 'write' as const,
        permissionName,
      })),
    ];
    return new RbacRegistry({
      revision: 0,
      roles: ROLES.map((name) => ({ name, description: null, isSystem: true, keycloakRoleId: null })),
      permissions: PERMISSIONS.map((name) => ({ name, description: null, isSystem: true })),
      rolePermissions,
      capabilities: CAPABILITY_CATALOG.map((capability) => ({
        id: capability.id,
        kind: capability.kind,
        mode: capability.mode,
        risk: capability.risk,
        resourceScoped: capability.resourceScoped,
        delegated: capability.delegated ?? false,
        enabled: true,
        requiresApproval: capability.requiresApproval ?? false,
        isSystem: true,
        requiredPermissions: [...capability.requiredPermissions],
      })),
      routePolicies: [],
      viewPermissions,
    });
  }
}
