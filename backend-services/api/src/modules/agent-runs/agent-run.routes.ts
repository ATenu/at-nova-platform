import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { AgentRunController } from './agent-run.controller';
import type { AgentRunService } from './agent-run.service';
import {
  createAgentRunBodySchema,
  listEventsQuerySchema,
  listRunsQuerySchema,
  runIdParamsSchema,
  traceQuerySchema,
} from './agent-run.schema';

// The chat entrypoint (`POST /a2a/chat`) is the single way to create an agent
// run: it captures the entitlement snapshot and enqueues the orchestration task
// by ID only. The `/agent-runs/:runId` surface is the run resource (read, stream,
// cancel) — there is intentionally no separate `POST /agent-runs` create route.
const agentChatPolicy = defineRoutePolicy({
  routeId: 'a2a.chat',
  permission: 'create-agent-run',
  audit: true,
});
const getRunPolicy = defineRoutePolicy({
  routeId: 'agent-runs.get',
  permission: 'read-agent-run',
  audit: true,
});
const streamEventsPolicy = defineRoutePolicy({
  routeId: 'agent-runs.events',
  permission: 'read-agent-run',
  audit: true,
});
const cancelRunPolicy = defineRoutePolicy({
  routeId: 'agent-runs.cancel',
  permission: 'cancel-agent-run',
  audit: true,
});

export interface AgentRunRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: AgentRunService;
}

/**
 * Router for `/a2a` agent interactions. `POST /a2a/chat` is the chat entrypoint:
 * it creates an agent run for the authenticated user and returns the run handle
 * (`202 Accepted`). Progress is then streamed from `/agent-runs/:runId/events`.
 */
export function createA2aChatRouter(deps: AgentRunRouterDeps): Router {
  const router = Router();
  const controller = new AgentRunController(deps.service);

  router.post(
    '/chat',
    deps.authenticate,
    authorize(agentChatPolicy),
    validateRequest({ body: createAgentRunBodySchema }),
    asyncHandler(controller.create),
  );

  return router;
}

export function createAgentRunRouter(deps: AgentRunRouterDeps): Router {
  const router = Router();
  const controller = new AgentRunController(deps.service);

  // Listed before `/:runId` so the literal collection route is matched first.
  router.get(
    '/',
    deps.authenticate,
    authorize(getRunPolicy),
    validateRequest({ query: listRunsQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:runId',
    deps.authenticate,
    authorize(getRunPolicy),
    validateRequest({ params: runIdParamsSchema }),
    asyncHandler(controller.getById),
  );

  router.get(
    '/:runId/events',
    deps.authenticate,
    authorize(streamEventsPolicy),
    validateRequest({ params: runIdParamsSchema, query: listEventsQuerySchema }),
    asyncHandler(controller.streamEvents),
  );

  router.get(
    '/:runId/trace',
    deps.authenticate,
    authorize(streamEventsPolicy),
    validateRequest({ params: runIdParamsSchema, query: traceQuerySchema }),
    asyncHandler(controller.getTrace),
  );

  router.post(
    '/:runId/cancel',
    deps.authenticate,
    authorize(cancelRunPolicy),
    validateRequest({ params: runIdParamsSchema }),
    asyncHandler(controller.cancel),
  );

  return router;
}
