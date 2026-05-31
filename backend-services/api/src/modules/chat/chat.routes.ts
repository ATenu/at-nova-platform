import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { ChatController } from './chat.controller';
import type { ChatService } from './chat.service';
import { conversationIdParamsSchema } from './chat.schema';

const listConversationsPolicy = defineRoutePolicy({ routeId: 'conversations.list', authenticated: true });
const createConversationPolicy = defineRoutePolicy({ routeId: 'conversations.create', authenticated: true });
const getConversationPolicy = defineRoutePolicy({ routeId: 'conversations.get', authenticated: true });

export interface ChatRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: ChatService;
}

/** Router for `/conversations` (owned by the authenticated user). */
export function createConversationsRouter(deps: ChatRouterDeps): Router {
  const router = Router();
  const controller = new ChatController(deps.service);

  router.get('/', deps.authenticate, authorize(listConversationsPolicy), asyncHandler(controller.listConversations));
  router.post('/', deps.authenticate, authorize(createConversationPolicy), asyncHandler(controller.createConversation));
  router.get(
    '/:id',
    deps.authenticate,
    authorize(getConversationPolicy),
    validateRequest({ params: conversationIdParamsSchema }),
    asyncHandler(controller.getConversation),
  );

  return router;
}
