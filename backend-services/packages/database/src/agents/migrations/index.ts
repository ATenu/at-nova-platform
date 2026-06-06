import { InitialAgentsSchema1717400000000 } from './1717400000000-InitialAgentsSchema';
import { WebhookOutboxAndStepIdempotency1717500000000 } from './1717500000000-WebhookOutboxAndStepIdempotency';
import { A2aAgentRegistry1717600000000 } from './1717600000000-A2aAgentRegistry';
import { LiveEventsAndWebhookFirehose1717700000000 } from './1717700000000-LiveEventsAndWebhookFirehose';
import { A2aAgentRegistryAdminOnboarding1718000000000 } from './1718000000000-A2aAgentRegistryAdminOnboarding';

/** Ordered list of migrations registered with the agents DataSource. */
export const AGENT_MIGRATIONS = [
  InitialAgentsSchema1717400000000,
  WebhookOutboxAndStepIdempotency1717500000000,
  A2aAgentRegistry1717600000000,
  LiveEventsAndWebhookFirehose1717700000000,
  A2aAgentRegistryAdminOnboarding1718000000000,
] as const;
