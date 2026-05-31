/**
 * Capability catalog: the single, code-owned source of truth that binds every
 * agent skill and MCP tool to the SAME domain permission(s) its equivalent REST
 * operation already enforces. This is the linchpin of per-user, per-action
 * authorization for the asynchronous orchestration plane.
 *
 * Authorization is AND-composed and default-deny:
 *   - A capability is invokable only if the acting user's permission set
 *     contains EVERY entry in `requiredPermissions`.
 *   - A capability with no descriptor in this catalog is unreachable.
 *
 * The Python execution plane mirrors this catalog via the generated `nova_authz`
 * package; a CI parity check fails the build if the two ever diverge. Never
 * inline raw capability ids or required permissions in feature code.
 */

import type { Permission } from './permissions';
import { rolesGrantPermission, type Role } from './permissions';

export const CAPABILITY_KINDS = ['agent-skill', 'mcp-tool'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CAPABILITY_MODES = ['read', 'write'] as const;
export type CapabilityMode = (typeof CAPABILITY_MODES)[number];

export const CAPABILITY_RISK_LEVELS = ['low', 'high'] as const;
export type CapabilityRisk = (typeof CAPABILITY_RISK_LEVELS)[number];

export interface CapabilityDescriptor {
  /** Stable catalog key, e.g. 'sales.report.customer'. */
  readonly id: string;
  readonly kind: CapabilityKind;
  /** Intent classification used for read/write down-scoping. */
  readonly mode: CapabilityMode;
  /** ALL required (AND). Empty means "unreachable" — never grant by default. */
  readonly requiredPermissions: readonly Permission[];
  /** 'high' additionally requires a recorded human approval gate. */
  readonly risk: CapabilityRisk;
  /** true => record/field-level check is enforced at the data-owning tool. */
  readonly resourceScoped: boolean;
}

/**
 * The catalog. Each entry's `requiredPermissions` MUST match the permission the
 * equivalent REST route requires today (a contract test enforces this), so the
 * planner filter, worker gate, and MCP server can never drift from the REST API.
 */
export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [
  {
    id: 'sales.report.customer',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales', 'read-customers'],
    risk: 'low',
    resourceScoped: true,
  },
  {
    id: 'sales.create',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-sales'],
    risk: 'low',
    resourceScoped: false,
  },
  {
    id: 'issues.list.pendingForCustomer',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-issues', 'read-customers'],
    risk: 'low',
    resourceScoped: true,
  },
  {
    id: 'actions.next',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-actions'],
    risk: 'low',
    resourceScoped: false,
  },
  {
    id: 'actions.markCompleted',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-actions'],
    risk: 'low',
    resourceScoped: true,
  },
  {
    id: 'issues.create',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['create-issues'],
    risk: 'low',
    resourceScoped: false,
  },
  {
    id: 'sop.read',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sop'],
    risk: 'low',
    resourceScoped: false,
  },
] as const;

const CAPABILITY_BY_ID: ReadonlyMap<string, CapabilityDescriptor> = new Map(
  CAPABILITY_CATALOG.map((capability) => [capability.id, capability]),
);

/** Look up a capability descriptor. Returns `undefined` for unknown ids (deny). */
export function getCapability(id: string): CapabilityDescriptor | undefined {
  return CAPABILITY_BY_ID.get(id);
}

/**
 * True only when the permission set grants EVERY required permission of the
 * capability (AND-composition, default deny).
 */
export function permissionsSatisfyCapability(
  capability: CapabilityDescriptor,
  permissions: ReadonlySet<Permission>,
): boolean {
  return capability.requiredPermissions.every((permission) => permissions.has(permission));
}

/**
 * Resolve the user's allowed capability set from a derived permission set. This
 * is the allowlist handed to the planner (Layer A) AND the basis for the
 * worker's authoritative code gate (Layer B).
 */
export function capabilitiesForPermissions(
  permissions: ReadonlySet<Permission>,
): CapabilityDescriptor[] {
  return CAPABILITY_CATALOG.filter((capability) =>
    permissionsSatisfyCapability(capability, permissions),
  );
}

/** True when the roles grant every permission a capability requires. */
export function rolesGrantCapability(roles: readonly Role[], capabilityId: string): boolean {
  const capability = getCapability(capabilityId);
  if (!capability || capability.requiredPermissions.length === 0) {
    return false;
  }
  return capability.requiredPermissions.every((permission) =>
    rolesGrantPermission(roles, permission),
  );
}

/** High-risk capabilities require a recorded human approval gate (section 18). */
export function capabilityRequiresApproval(capability: CapabilityDescriptor): boolean {
  return capability.risk === 'high';
}
