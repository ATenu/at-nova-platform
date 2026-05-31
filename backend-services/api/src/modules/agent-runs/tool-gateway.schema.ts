import { z } from 'zod';

export const toolCallParamsSchema = z.object({ runId: z.string().uuid() });
export type ToolCallParams = z.infer<typeof toolCallParamsSchema>;

export const toolCallBodySchema = z.object({
  capabilityId: z.string().trim().min(1).max(128),
  // Capability-specific input is validated by the executor against a per-tool
  // schema; here it is just constrained to a JSON object.
  input: z.record(z.unknown()).default({}),
});
export type ToolCallBody = z.infer<typeof toolCallBodySchema>;

export const finalizeBodySchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(256),
        href: z.string().trim().min(1).max(2048),
        type: z.enum(['customer', 'sale', 'issue', 'action', 'sop', 'external']),
      }),
    )
    .max(20)
    .default([]),
});
export type FinalizeBody = z.infer<typeof finalizeBodySchema>;
