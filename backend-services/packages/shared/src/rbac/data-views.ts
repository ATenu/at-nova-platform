/**
 * Per-view domain-permission map for the curated `mcp_read` free-query surface.
 *
 * This is the single source of truth that binds each `mcp_read` view to the SAME
 * domain permission its equivalent REST route already enforces. The DB MCP server
 * authorizes every SELECT by mapping the views a query touches to these
 * permissions and checking them against the run's entitlement snapshot
 * (default deny; a join across views requires EVERY touched view's permission).
 * This replaces the coarse `read-data` gate: access to data is governed solely by
 * the user's domain permissions, exactly as it is for the REST API.
 */

import type { Permission } from './permissions';

/** `mcp_read.<view>` -> the domain permission required to read it. */
export const MCP_READ_VIEW_PERMISSIONS: Readonly<Record<string, Permission>> = {
  customers: 'read-customers',
  products: 'read-sales',
  sales: 'read-sales',
  products_sold: 'read-sales',
  customer_issues: 'read-issues',
  issue_actions: 'read-actions',
  my_assigned_actions: 'read-actions',
  sops: 'read-sop',
  sop_details: 'read-sop',
  users: 'read-users',
} as const;

/** Resolve the permission a view requires, or `undefined` for an unknown view. */
export function permissionForView(view: string): Permission | undefined {
  return MCP_READ_VIEW_PERMISSIONS[view];
}

/**
 * The subset of `mcp_read` view names the permission set may read. Used by the
 * MCP server to (a) decide whether to expose the SQL tools at all and (b) filter
 * the advertised schema so the planner only sees views it can actually query.
 */
export function accessibleViews(permissions: ReadonlySet<Permission>): string[] {
  return Object.keys(MCP_READ_VIEW_PERMISSIONS).filter((view) =>
    permissions.has(MCP_READ_VIEW_PERMISSIONS[view] as Permission),
  );
}

/**
 * Per-domain WRITE permission map — the mutate-side analogue of
 * `MCP_READ_VIEW_PERMISSIONS`, keyed by the SAME curated domain names.
 *
 * IMPORTANT — this is NOT a SQL surface. There is deliberately no `mcp_write`
 * schema: the agent never issues write SQL. Every agent write is a typed,
 * cataloged capability (`capabilities.ts`, e.g. `issues.update`, `sop.update`,
 * `actions.addComment`, `sales.create`) executed through the Node tool gateway,
 * which re-checks that capability's `requiredPermissions` against the run's
 * entitlement snapshot. This map therefore expresses, per business domain, the
 * domain permission a caller must hold to mutate it — mirroring the same
 * permission those write capabilities already require (a contract test in
 * `data-views.test.ts` keeps the two in lock-step). It is the symmetric,
 * single-source answer to "which domains may this permission set write?" used by
 * entitlement reasoning and quality tooling; the authoritative runtime gate
 * stays the capability catalog + tool gateway.
 *
 * Only domains with an actual cataloged agent-write capability are listed
 * (default deny): `products` has no write permission and `customers`/`users`
 * have no agent-write capability, so none of them appear here.
 */
export const MCP_WRITE_VIEW_PERMISSIONS: Readonly<Record<string, Permission>> = {
  sales: 'write-sales',
  products_sold: 'write-sales',
  customer_issues: 'write-issues',
  issue_actions: 'write-actions',
  my_assigned_actions: 'write-actions',
  sops: 'write-sop',
  sop_details: 'write-sop',
} as const;

/** Resolve the write permission a domain requires, or `undefined` if not writable. */
export function permissionForWriteView(view: string): Permission | undefined {
  return MCP_WRITE_VIEW_PERMISSIONS[view];
}

/**
 * The subset of curated domain names the permission set may WRITE. The mutate-side
 * analogue of `accessibleViews`: used by entitlement reasoning / quality tooling
 * to determine which domains a role can mutate via the agent's cataloged write
 * capabilities (default deny).
 */
export function writableViews(permissions: ReadonlySet<Permission>): string[] {
  return Object.keys(MCP_WRITE_VIEW_PERMISSIONS).filter((view) =>
    permissions.has(MCP_WRITE_VIEW_PERMISSIONS[view] as Permission),
  );
}
