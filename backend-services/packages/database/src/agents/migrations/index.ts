import { InitialAgentsSchema1717400000000 } from './1717400000000-InitialAgentsSchema';
import { WebhookOutboxAndStepIdempotency1717500000000 } from './1717500000000-WebhookOutboxAndStepIdempotency';

/** Ordered list of migrations registered with the agents DataSource. */
export const AGENT_MIGRATIONS = [
  InitialAgentsSchema1717400000000,
  WebhookOutboxAndStepIdempotency1717500000000,
] as const;
