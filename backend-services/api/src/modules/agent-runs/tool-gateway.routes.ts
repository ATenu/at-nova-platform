import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { ToolGatewayController } from './tool-gateway.controller';
import type { ToolGatewayService } from './tool-gateway.service';
import {
  finalizeBodySchema,
  toolCallBodySchema,
  toolCallParamsSchema,
} from './tool-gateway.schema';

export interface ToolGatewayRouterDeps {
  /** Service-token authentication (audience-restricted, azp-pinned). */
  readonly serviceAuthenticate: RequestHandler;
  readonly service: ToolGatewayService;
}

/**
 * Internal MCP tool-gateway routes. Mounted under `/internal/agent-runs` and
 * reachable only with a valid worker service token. These are NOT user-facing
 * and carry no `defineRoutePolicy` (authorization is the entitlement-snapshot
 * re-enforcement inside the service).
 */
export function createToolGatewayRouter(deps: ToolGatewayRouterDeps): Router {
  const router = Router();
  const controller = new ToolGatewayController(deps.service);

  router.get(
    '/:runId/prompt',
    deps.serviceAuthenticate,
    validateRequest({ params: toolCallParamsSchema }),
    asyncHandler(controller.getPrompt),
  );

  router.post(
    '/:runId/tool-calls',
    deps.serviceAuthenticate,
    validateRequest({ params: toolCallParamsSchema, body: toolCallBodySchema }),
    asyncHandler(controller.execute),
  );

  router.post(
    '/:runId/finalize',
    deps.serviceAuthenticate,
    validateRequest({ params: toolCallParamsSchema, body: finalizeBodySchema }),
    asyncHandler(controller.finalize),
  );

  return router;
}
