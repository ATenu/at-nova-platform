import type { Permission } from '@nova/shared';

/**
 * Declarative access policy for a route. A route is either explicitly public,
 * available to any authenticated principal (no domain permission, e.g. the
 * caller's own profile), or requires a single typed domain permission. A
 * missing/ambiguous policy is a programming error and fails closed at
 * composition time.
 */
export type RouteAccessPolicy =
  | { readonly routeId: string; readonly public: true }
  | { readonly routeId: string; readonly authenticated: true; readonly audit?: boolean }
  | {
      readonly routeId: string;
      readonly public?: false;
      readonly permission: Permission;
      readonly audit?: boolean;
    };

const registry = new Map<string, RouteAccessPolicy>();

/**
 * Register and return a route policy. Route IDs must be unique so the registry
 * is an authoritative, inspectable list of every route's access requirements.
 */
export function defineRoutePolicy(policy: RouteAccessPolicy): RouteAccessPolicy {
  if (registry.has(policy.routeId)) {
    throw new Error(`Duplicate route policy registered for routeId "${policy.routeId}".`);
  }
  registry.set(policy.routeId, policy);
  return policy;
}

export function getRegisteredPolicies(): readonly RouteAccessPolicy[] {
  return [...registry.values()];
}
