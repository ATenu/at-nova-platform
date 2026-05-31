import { AgentRun } from './agent-run.entity';
import { AgentRunEntitlement } from './agent-run-entitlement.entity';
import { AgentRunEvent } from './agent-run-event.entity';
import { WebhookAuthConfig } from './webhook-auth-config.entity';
import { WebhookDelivery } from './webhook-delivery.entity';

export { AgentRun, AgentRunEntitlement, AgentRunEvent, WebhookAuthConfig, WebhookDelivery };

/** Orchestration-plane entity classes registered with the agents DataSource. */
export const AGENT_ENTITIES = [
  AgentRun,
  AgentRunEntitlement,
  AgentRunEvent,
  WebhookAuthConfig,
  WebhookDelivery,
] as const;
