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
