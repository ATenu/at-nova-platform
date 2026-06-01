import { accessibleViews, permissionForView, type Permission } from '@nova/shared';

/**
 * Per-view authorization for the free-query surface. Each `mcp_read` view maps to
 * the SAME domain permission its REST route requires (`@nova/shared`
 * `data-views.ts`); access to data is governed solely by these permissions,
 * mirroring the REST API. Kept in its own module (no MCP SDK types) so the
 * security-critical decision logic is unit-testable in isolation.
 */

/** The set of `mcp_read` view names the snapshot's permissions entitle. */
export function entitledViews(permissions: readonly string[]): Set<string> {
  return new Set(accessibleViews(new Set<Permission>(permissions as Permission[])));
}

export interface ViewDenial {
  readonly view: string;
  readonly requiredPermission?: string;
}

/**
 * Default-deny across views: returns the first relation the caller is NOT
 * entitled to (so a join requires EVERY touched view's permission), or `null`
 * when every relation is permitted. `relations` are already constrained to the
 * allowlisted views by the SQL validator.
 */
export function findForbiddenView(
  relations: readonly string[],
  entitled: ReadonlySet<string>,
): ViewDenial | null {
  const view = relations.find((relation) => !entitled.has(relation));
  if (view === undefined) {
    return null;
  }
  const requiredPermission = permissionForView(view);
  return requiredPermission === undefined ? { view } : { view, requiredPermission };
}
