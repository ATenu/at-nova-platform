import { InitialAgentsSchema1717400000000 } from './1717400000000-InitialAgentsSchema';
import { WebhookOutboxAndStepIdempotency1717500000000 } from './1717500000000-WebhookOutboxAndStepIdempotency';
import { A2aAgentRegistry1717600000000 } from './1717600000000-A2aAgentRegistry';

/** Ordered list of migrations registered with the agents DataSource. */
export const AGENT_MIGRATIONS = [
  InitialAgentsSchema1717400000000,
  WebhookOutboxAndStepIdempotency1717500000000,
  A2aAgentRegistry1717600000000,
] as const;
