import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { MeController } from './me.controller';
import type { UserRepository } from '../users/user.repository';

const mePolicy = defineRoutePolicy({ routeId: 'auth.me', authenticated: true });

export interface MeRouterDeps {
  readonly authenticate: RequestHandler;
  readonly users: UserRepository;
}

/** Build the `/auth` router. `/auth/me` is available to any authenticated user. */
export function createMeRouter(deps: MeRouterDeps): Router {
  const router = Router();
  const controller = new MeController(deps.users);
  router.get('/me', deps.authenticate, authorize(mePolicy), asyncHandler(controller.me));
  return router;
}
