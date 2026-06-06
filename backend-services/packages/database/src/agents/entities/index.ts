import {
  A2aAgentRegistration,
  type A2aAgentSource,
  type A2aAgentStatus,
} from './a2a-agent-registration.entity';
import { AgentRun } from './agent-run.entity';
import { AgentRunEntitlement } from './agent-run-entitlement.entity';
import { AgentRunEvent } from './agent-run-event.entity';
import { WebhookAuthConfig } from './webhook-auth-config.entity';
import { WebhookDelivery } from './webhook-delivery.entity';

export {
  A2aAgentRegistration,
  AgentRun,
  AgentRunEntitlement,
  AgentRunEvent,
  WebhookAuthConfig,
  WebhookDelivery,
};
export type { A2aAgentSource, A2aAgentStatus };

/** Orchestration-plane entity classes registered with the agents DataSource. */
export const AGENT_ENTITIES = [
  A2aAgentRegistration,
  AgentRun,
  AgentRunEntitlement,
  AgentRunEvent,
  WebhookAuthConfig,
  WebhookDelivery,
] as const;
