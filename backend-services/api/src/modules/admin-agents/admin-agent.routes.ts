import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { AdminAgentController } from './admin-agent.controller';
import type { AdminAgentService } from './admin-agent.service';
import {
  agentNameParamsSchema,
  onboardAgentBodySchema,
  setAgentEnabledBodySchema,
} from './admin-agent.schema';

// Reads require `read-agents`; mutations require `write-agents`. All audited.
// Reconciled into `route_policies` on boot and admin-rebindable thereafter.
const listAgentsPolicy = defineRoutePolicy({ routeId: 'admin.agents.list', permission: 'read-agents', audit: true });
const getAgentPolicy = defineRoutePolicy({ routeId: 'admin.agents.get', permission: 'read-agents', audit: true });
const onboardAgentPolicy = defineRoutePolicy({ routeId: 'admin.agents.onboard', permission: 'write-agents', audit: true });
const setEnabledPolicy = defineRoutePolicy({ routeId: 'admin.agents.setEnabled', permission: 'write-agents', audit: true });
const removeAgentPolicy = defineRoutePolicy({ routeId: 'admin.agents.remove', permission: 'write-agents', audit: true });

export interface AdminAgentRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: AdminAgentService;
}

/** Build the `/admin/agents` router (view + onboard + manage admin agents). */
export function createAdminAgentRouter(deps: AdminAgentRouterDeps): Router {
  const router = Router();
  const controller = new AdminAgentController(deps.service);

  router.get('/', deps.authenticate, authorize(listAgentsPolicy), asyncHandler(controller.list));

  router.post(
    '/onboard',
    deps.authenticate,
    authorize(onboardAgentPolicy),
    validateRequest({ body: onboardAgentBodySchema }),
    asyncHandler(controller.onboard),
  );

  router.get(
    '/:name',
    deps.authenticate,
    authorize(getAgentPolicy),
    validateRequest({ params: agentNameParamsSchema }),
    asyncHandler(controller.get),
  );

  router.patch(
    '/:name',
    deps.authenticate,
    authorize(setEnabledPolicy),
    validateRequest({ params: agentNameParamsSchema, body: setAgentEnabledBodySchema }),
    asyncHandler(controller.setEnabled),
  );

  router.delete(
    '/:name',
    deps.authenticate,
    authorize(removeAgentPolicy),
    validateRequest({ params: agentNameParamsSchema }),
    asyncHandler(controller.remove),
  );

  return router;
}
