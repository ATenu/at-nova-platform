import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { ActionController } from './action.controller';
import type { ActionService } from './action.service';
import {
  actionIdParamsSchema,
  addCommentBodySchema,
  listActionsQuerySchema,
  updateActionBodySchema,
} from './action.schema';

const listActionsPolicy = defineRoutePolicy({ routeId: 'actions.list', permission: 'read-actions', audit: true });
const updateActionPolicy = defineRoutePolicy({
  routeId: 'actions.update',
  permission: 'write-actions',
  audit: true,
});
const addCommentPolicy = defineRoutePolicy({
  routeId: 'actions.addComment',
  permission: 'write-actions',
  audit: true,
});

export interface ActionRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: ActionService;
}

export function createActionRouter(deps: ActionRouterDeps): Router {
  const router = Router();
  const controller = new ActionController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listActionsPolicy),
    validateRequest({ query: listActionsQuerySchema }),
    asyncHandler(controller.list),
  );

  router.patch(
    '/:id',
    deps.authenticate,
    authorize(updateActionPolicy),
    validateRequest({ params: actionIdParamsSchema, body: updateActionBodySchema }),
    asyncHandler(controller.update),
  );

  router.post(
    '/:id/comments',
    deps.authenticate,
    authorize(addCommentPolicy),
    validateRequest({ params: actionIdParamsSchema, body: addCommentBodySchema }),
    asyncHandler(controller.addComment),
  );

  return router;
}
