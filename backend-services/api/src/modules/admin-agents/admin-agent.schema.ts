import { z } from 'zod';

/**
 * Request contracts for the admin agent-registry surface. The deep SSRF host
 * validation is authoritative server-side in the orchestrator (it owns the
 * allowlist); Node performs structural URL validation only and never duplicates
 * the allowlist. The card itself is never hand-entered — it is fetched live over
 * native A2A — so only registration metadata is accepted here.
 */

/** DNS-ish registry key shape, consistent with RBAC names (safe as a PK). */
const AGENT_NAME = /^[a-z][a-z0-9-]{1,98}[a-z0-9]$/;

const hostUrl = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
    } catch {
      return false;
    }
  }, 'Host URL must be an http(s) URL with a hostname');

export const onboardAgentBodySchema = z.object({
  hostUrl,
  audience: z.string().trim().min(1).max(255),
  name: z.string().trim().regex(AGENT_NAME, 'Invalid agent name').optional(),
  displayName: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
});

export const setAgentEnabledBodySchema = z.object({
  enabled: z.boolean(),
});

export const agentNameParamsSchema = z.object({
  name: z.string().trim().regex(AGENT_NAME, 'Invalid agent name'),
});

export type OnboardAgentBody = z.infer<typeof onboardAgentBodySchema>;
export type SetAgentEnabledBody = z.infer<typeof setAgentEnabledBodySchema>;
export type AgentNameParams = z.infer<typeof agentNameParamsSchema>;
