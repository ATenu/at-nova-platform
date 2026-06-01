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

/**
 * Event visibility scope a caller may request for the trace/stream surfaces.
 * `user` (default) is the normal browser channel: only `user`-visibility events.
 * `full` additionally includes `internal` (node execution) and `security`
 * (authz allow/deny) events — the complete technical timeline. It is owner-only
 * (ownership is enforced server-side) and opt-in; the default stays `user` so
 * the browser channel is not widened unless explicitly requested.
 */
export const eventDetailSchema = z.enum(['user', 'full']).default('user');
export type EventDetail = z.infer<typeof eventDetailSchema>;

export const listEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).default(0),
  detail: eventDetailSchema,
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const traceQuerySchema = z.object({
  detail: eventDetailSchema,
});
export type TraceQuery = z.infer<typeof traceQuerySchema>;

export const listRunsQuerySchema = z.object({
  conversationId: z.string().uuid(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

/** Idempotency-Key header contract for run submission. */
export const idempotencyKeySchema = z.string().trim().min(1).max(255);
