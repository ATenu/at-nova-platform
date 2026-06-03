import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '@nova/shared';
import { getActiveRegistry } from '../rbac/registry-holder';
import type { RoutePolicyKind, RoutePolicyView } from '../rbac/rbac-registry';
import type { RouteAccessPolicy } from './route-policy';

/**
 * Resolve the effective policy for a route: the DB-driven registry binding takes
 * precedence (so an admin can rebind which permission gates a route without a
 * redeploy), falling back to the code-declared default. Returns a normalized view
 * with default-deny semantics for malformed inputs.
 */
function resolveEffectivePolicy(policy: RouteAccessPolicy): RoutePolicyView {
  const fromRegistry = getActiveRegistry().routePolicy(policy.routeId);
  if (fromRegistry) {
    return fromRegistry;
  }
  if ('public' in policy && policy.public === true) {
    return { routeId: policy.routeId, kind: 'public', permissionName: null, audit: false };
  }
  if ('authenticated' in policy && policy.authenticated === true) {
    return {
      routeId: policy.routeId,
      kind: 'authenticated',
      permissionName: null,
      audit: policy.audit === true,
    };
  }
  if ('permission' in policy) {
    return {
      routeId: policy.routeId,
      kind: 'permission' satisfies RoutePolicyKind,
      permissionName: policy.permission,
      audit: policy.audit === true,
    };
  }
  // Unknown shape: deny.
  return { routeId: policy.routeId, kind: 'permission', permissionName: null, audit: false };
}

/**
 * Centralized authorization middleware. Enforces the route's effective policy
 * (DB-driven, with a code-declared fallback) against the typed AuthContext.
 * Default deny: anything not explicitly granted is rejected.
 */
export function authorize(policy: RouteAccessPolicy): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const effective = resolveEffectivePolicy(policy);

    if (effective.kind === 'public') {
      next();
      return;
    }

    const auth = req.auth;
    if (!auth) {
      // authenticate must run before authorize on protected routes.
      next(new UnauthenticatedError());
      return;
    }

    if (effective.kind === 'authenticated') {
      if (effective.audit) {
        req.log?.info({ routeId: effective.routeId, subject: auth.subject }, 'authenticated access');
      }
      next();
      return;
    }

    const required = effective.permissionName;
    if (!required || !auth.permissions.has(required)) {
      req.log?.warn(
        { routeId: effective.routeId, requiredPermission: required, subject: auth.subject },
        'authorization denied',
      );
      next(new ForbiddenError());
      return;
    }

    if (effective.audit) {
      req.log?.info(
        { routeId: effective.routeId, permission: required, subject: auth.subject },
        'authorization granted',
      );
    }

    next();
  };
}
