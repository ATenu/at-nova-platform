import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { RbacRegistryController } from './rbac-registry.controller';
import type { RbacRegistryService } from '../../rbac/rbac-registry.service';

// Any authenticated principal may read the effective policy so the frontend and
// agents can build their views dynamically. It exposes policy structure only.
const registryPolicy = defineRoutePolicy({ routeId: 'rbac.registry.get', authenticated: true });

export interface RbacRegistryRouterDeps {
  readonly authenticate: RequestHandler;
  readonly registryService: RbacRegistryService;
}

/** Build the `/rbac` router exposing the single dynamic registry endpoint. */
export function createRbacRegistryRouter(deps: RbacRegistryRouterDeps): Router {
  const router = Router();
  const controller = new RbacRegistryController(deps.registryService);
  router.get('/registry', deps.authenticate, authorize(registryPolicy), asyncHandler(controller.get));
  return router;
}
