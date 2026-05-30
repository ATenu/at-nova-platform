import { z } from 'zod';

export const conversationIdParamsSchema = z.object({ id: z.string().uuid() });
export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>;

const entityLinkTypeSchema = z.enum(['customer', 'sale', 'issue', 'action', 'sop']);

export const agentChatBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  context: z
    .object({
      currentRoute: z.string().trim().max(512).optional(),
      selectedEntity: z
        .object({ type: entityLinkTypeSchema, id: z.string().trim().min(1).max(255) })
        .optional(),
    })
    .optional(),
});

export type AgentChatBody = z.infer<typeof agentChatBodySchema>;
