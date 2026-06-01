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
  /**
   * true => the capability is agent-internal: it is NOT surfaced on the
   * orchestrator's LLM menu and is selected/executed only inside an A2A agent
   * (re-gated per call, Layer B). The orchestrator is a pure delegator and only
   * ever offers the non-delegated umbrella skills (`data.analyse.read`,
   * `data.act.write`). Absent => false (orchestrator-visible). This is a
   * routing/exposure flag only; authorization is still per `requiredPermissions`.
   */
  readonly delegated?: boolean;
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
    delegated: true,
  },
  {
    // Aggregates the line items of a customer's sales into the distinct products
    // they purchased. Mirrors the read permissions of `sales.report.customer`
    // (touches both the customer and their sales/line items).
    id: 'sales.products.forCustomer',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales', 'read-customers'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'sales.create',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-sales'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'issues.list.pendingForCustomer',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-issues', 'read-customers'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'actions.next',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-actions'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'actions.markCompleted',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-actions'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'issues.create',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['create-issues'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'sop.read',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sop'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  // --- Conversational resolver + detail reads --------------------------------
  // These let the orchestrator resolve a human reference (name/email/title) to
  // the record id needed by a scoped read/write, so the user never has to type a
  // UUID. Each mirrors the permission of its equivalent REST read; rows still go
  // through the user's own permission-gated business service (NOT the redacted
  // `mcp_read` free-query surface), so they may return display names the entitled
  // user is allowed to see.
  {
    id: 'customers.search',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-customers'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'customers.get',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-customers'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'products.search',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'products.get',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'sales.list',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'sales.get',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-sales'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'issues.list',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-issues'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'issues.get',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-issues'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'actions.list',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-actions'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'actions.get',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['read-actions'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  // --- Domain writes (mirror the permission of the equivalent REST mutation) --
  // RBAC-gated, low risk like the existing writes: a write runs only if the
  // acting user's entitlement snapshot grants the required permission.
  {
    id: 'actions.addComment',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-actions'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'actions.update',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-actions'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'issues.update',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-issues'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'sop.create',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-sop'],
    risk: 'low',
    resourceScoped: false,
    delegated: true,
  },
  {
    id: 'sop.update',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-sop'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  {
    id: 'sop.addVersion',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['write-sop'],
    risk: 'low',
    resourceScoped: true,
    delegated: true,
  },
  // --- Free-query data layer (DB MCP server + `at-sql-analyser`) -------------
  // These are reachable for any agent-run user (gated on the universal
  // `create-agent-run`); they grant NO data by themselves. The authorization
  // boundary is per VIEW: the DB MCP server maps each `mcp_read` view a query
  // touches to its domain permission (`data-views.ts`, mirroring the REST routes)
  // and re-checks it against the run's entitlement snapshot, exposing only the
  // views the user is entitled to. This replaces the coarse `read-data` gate.
  {
    id: 'data.schema.describe',
    kind: 'mcp-tool',
    mode: 'read',
    requiredPermissions: ['create-agent-run'],
    risk: 'low',
    resourceScoped: false,
  },
  {
    id: 'data.query.select',
    kind: 'mcp-tool',
    mode: 'read',
    requiredPermissions: ['create-agent-run'],
    risk: 'low',
    resourceScoped: true,
  },
  // --- Umbrella delegation skills (the ONLY caps the orchestrator surfaces) ---
  // `data.analyse.read` and `data.act.write` are broad delegation ENTRY POINTS,
  // not the authorization boundary. The orchestrator is a pure delegator: it
  // hands a GOAL to `at-sql-analyser`, which then selects and chains the
  // concrete `delegated` capabilities above (and the free-form SQL `mcp-tool`s),
  // re-gating EACH one per its own `requiredPermissions` (Layer B) and having
  // the Node gateway / MCP server re-check it. Because they are mere entry
  // points, they are gated only on the universal `create-agent-run` permission
  // (every agent-using role holds it); they grant NO data access by themselves.
  // The free-form SQL sub-tools are exposed per VIEW: the MCP server only lets a
  // query touch a `mcp_read` view when the caller holds that view's domain
  // permission (see `data-views.ts`), so no data is reachable without it.
  {
    id: 'data.analyse.read',
    kind: 'agent-skill',
    mode: 'read',
    requiredPermissions: ['create-agent-run'],
    risk: 'low',
    resourceScoped: true,
    delegated: false,
  },
  // `data.act.write` is a DISPATCH skill: it may only invoke already-cataloged
  // write capabilities (e.g. `sales.create`), each independently gated on its
  // own domain permission AND the high-risk approval gate, so the agent can
  // never mint new write authority. As a broad delegation entry point it is
  // gated only on the universal `create-agent-run` permission (NOT on any write
  // permission) — and is marked `risk: 'high'`, so dispatching it additionally
  // requires a recorded human approval. This keeps the catalog invariant that
  // every capability declares at least one required permission (default deny;
  // "no standalone permission" is realized as "no standalone *write* permission").
  {
    id: 'data.act.write',
    kind: 'agent-skill',
    mode: 'write',
    requiredPermissions: ['create-agent-run'],
    risk: 'high',
    resourceScoped: true,
    delegated: false,
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
