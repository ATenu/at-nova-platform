import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { IssueController } from './issue.controller';
import type { IssueService } from './issue.service';
import {
  createIssueBodySchema,
  issueIdParamsSchema,
  listIssuesQuerySchema,
  updateIssueBodySchema,
} from './issue.schema';

const listIssuesPolicy = defineRoutePolicy({ routeId: 'issues.list', permission: 'read-issues', audit: true });
const getIssuePolicy = defineRoutePolicy({ routeId: 'issues.get', permission: 'read-issues', audit: true });
const createIssuePolicy = defineRoutePolicy({
  routeId: 'issues.create',
  permission: 'create-issues',
  audit: true,
});
const updateIssuePolicy = defineRoutePolicy({
  routeId: 'issues.update',
  permission: 'write-issues',
  audit: true,
});

export interface IssueRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: IssueService;
}

export function createIssueRouter(deps: IssueRouterDeps): Router {
  const router = Router();
  const controller = new IssueController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listIssuesPolicy),
    validateRequest({ query: listIssuesQuerySchema }),
    asyncHandler(controller.list),
  );

  router.post(
    '/',
    deps.authenticate,
    authorize(createIssuePolicy),
    validateRequest({ body: createIssueBodySchema }),
    asyncHandler(controller.create),
  );

  router.get(
    '/:id',
    deps.authenticate,
    authorize(getIssuePolicy),
    validateRequest({ params: issueIdParamsSchema }),
    asyncHandler(controller.getById),
  );

  router.patch(
    '/:id',
    deps.authenticate,
    authorize(updateIssuePolicy),
    validateRequest({ params: issueIdParamsSchema, body: updateIssueBodySchema }),
    asyncHandler(controller.update),
  );

  return router;
}
