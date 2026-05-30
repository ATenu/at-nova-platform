import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { SopController } from './sop.controller';
import type { SopService } from './sop.service';
import {
  createSopBodySchema,
  createSopVersionBodySchema,
  listSopsQuerySchema,
  sopIdParamsSchema,
  updateSopBodySchema,
} from './sop.schema';

const listSopsPolicy = defineRoutePolicy({ routeId: 'sops.list', permission: 'read-sop', audit: true });
const getSopPolicy = defineRoutePolicy({ routeId: 'sops.get', permission: 'read-sop', audit: true });
const createSopPolicy = defineRoutePolicy({ routeId: 'sops.create', permission: 'write-sop', audit: true });
const updateSopPolicy = defineRoutePolicy({ routeId: 'sops.update', permission: 'write-sop', audit: true });
const addVersionPolicy = defineRoutePolicy({
  routeId: 'sops.addVersion',
  permission: 'write-sop',
  audit: true,
});

export interface SopRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: SopService;
}

export function createSopRouter(deps: SopRouterDeps): Router {
  const router = Router();
  const controller = new SopController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listSopsPolicy),
    validateRequest({ query: listSopsQuerySchema }),
    asyncHandler(controller.list),
  );

  router.post(
    '/',
    deps.authenticate,
    authorize(createSopPolicy),
    validateRequest({ body: createSopBodySchema }),
    asyncHandler(controller.create),
  );

  router.get(
    '/:id',
    deps.authenticate,
    authorize(getSopPolicy),
    validateRequest({ params: sopIdParamsSchema }),
    asyncHandler(controller.getById),
  );

  router.patch(
    '/:id',
    deps.authenticate,
    authorize(updateSopPolicy),
    validateRequest({ params: sopIdParamsSchema, body: updateSopBodySchema }),
    asyncHandler(controller.update),
  );

  router.post(
    '/:id/versions',
    deps.authenticate,
    authorize(addVersionPolicy),
    validateRequest({ params: sopIdParamsSchema, body: createSopVersionBodySchema }),
    asyncHandler(controller.addVersion),
  );

  return router;
}
