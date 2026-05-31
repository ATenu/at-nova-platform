import { z } from 'zod';

const entityLinkTypeSchema = z.enum(['customer', 'sale', 'issue', 'action', 'sop']);

export const createAgentRunBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  context: z
    .object({
      currentRoute: z.string().trim().max(512).optional(),
      selectedEntity: z
        .object({ type: entityLinkTypeSchema, id: z.string().trim().min(1).max(255) })
        .optional(),
    })
    .optional(),
});

export type CreateAgentRunBody = z.infer<typeof createAgentRunBodySchema>;

export const runIdParamsSchema = z.object({ runId: z.string().uuid() });
export type RunIdParams = z.infer<typeof runIdParamsSchema>;

export const listEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).default(0),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/** Idempotency-Key header contract for run submission. */
export const idempotencyKeySchema = z.string().trim().min(1).max(255);
