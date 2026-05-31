import { booleanFromEnv, loadConfig } from '@nova/shared';
import { z } from 'zod';

/**
 * Connection configuration for the isolated orchestration-state database
 * (`postgres-agents`). Kept separate from the business DB config so the control
 * plane connects to both with distinct credentials, and the execution plane can
 * never connect to the business DB.
 */
const agentsDatabaseEnvSchema = z.object({
  AGENTS_DATABASE_URL: z.string().url(),
  AGENTS_DB_SSL: booleanFromEnv.default('false'),
  DB_LOGGING: booleanFromEnv.default('false'),
});

export type AgentsDatabaseConfig = z.infer<typeof agentsDatabaseEnvSchema>;

export function loadAgentsDatabaseConfig(): AgentsDatabaseConfig {
  return loadConfig(agentsDatabaseEnvSchema);
}
