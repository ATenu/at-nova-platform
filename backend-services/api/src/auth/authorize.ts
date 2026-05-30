import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, rolesGrantPermission, UnauthenticatedError } from '@nova/shared';
import type { RouteAccessPolicy } from './route-policy';

/**
 * Centralized authorization middleware. Enforces the route's declared policy
 * against the typed AuthContext. Default deny: anything not explicitly granted
 * is rejected.
 */
export function authorize(policy: RouteAccessPolicy): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if ('public' in policy && policy.public === true) {
      next();
      return;
    }

    const auth = req.auth;
    if (!auth) {
      // authenticate must run before authorize on protected routes.
      next(new UnauthenticatedError());
      return;
    }

    // Routes available to any authenticated principal (no domain permission).
    if ('authenticated' in policy && policy.authenticated === true) {
      if (policy.audit === true) {
        req.log?.info({ routeId: policy.routeId, subject: auth.subject }, 'authenticated access');
      }
      next();
      return;
    }

    if (!('permission' in policy)) {
      // Defensive: a policy without a permission is a programming error.
      next(new ForbiddenError());
      return;
    }

    if (!rolesGrantPermission(auth.roles, policy.permission)) {
      req.log?.warn(
        { routeId: policy.routeId, requiredPermission: policy.permission, subject: auth.subject },
        'authorization denied',
      );
      next(new ForbiddenError());
      return;
    }

    if (policy.audit === true) {
      req.log?.info(
        { routeId: policy.routeId, permission: policy.permission, subject: auth.subject },
        'authorization granted',
      );
    }

    next();
  };
}
