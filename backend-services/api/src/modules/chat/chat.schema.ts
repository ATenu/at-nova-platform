import { z } from 'zod';

export const conversationIdParamsSchema = z.object({ id: z.string().uuid() });
export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>;
