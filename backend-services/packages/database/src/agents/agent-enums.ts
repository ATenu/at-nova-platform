/**
 * Orchestration-plane domain types for the isolated `postgres-agents` database.
 *
 * Statuses, event types, and visibilities are stored as text columns (not PG
 * enums) so the lifecycle can evolve without an enum migration, while these
 * string-union types keep TypeScript callers strongly typed. The Python
 * execution plane mirrors the same string values.
 */

export const AGENT_RUN_STATUSES = [
  'queued',
  'accepted',
  'planning',
  'running',
  'waiting_for_agent',
  'waiting_for_tool',
  'waiting_for_input',
  'retrying',
  'partially_completed',
  'completed',
  'failed',
  'canceled',
  'expired',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Statuses from which no further work happens (the worker returns early). */
export const TERMINAL_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'failed',
  'canceled',
  'expired',
];

export const AGENT_EVENT_VISIBILITIES = ['user', 'internal', 'security'] as const;
export type AgentEventVisibility = (typeof AGENT_EVENT_VISIBILITIES)[number];

export const AGENT_EVENT_TYPES = [
  'run.created',
  'run.accepted',
  'run.started',
  'planner.started',
  'planner.completed',
  'agent.selected',
  'agent.call.started',
  'agent.call.progress',
  'agent.call.completed',
  'agent.call.failed',
  // Sub-events forwarded from an A2A agent's own run loop. Carry cataloged
  // capability inputs/outputs (never raw SQL or rows) so every step is trackable
  // over SSE and the webhook.
  'agent.task.received',
  'agent.task.denied',
  'agent.schema.loaded',
  'agent.query.started',
  'agent.query.completed',
  'agent.query.rejected',
  // Structured (cataloged) read capability sub-steps dispatched via the Node
  // gateway (e.g. customers.search -> sales.report.customer). Carry the
  // capability id and a row count, never raw rows.
  'agent.read.started',
  'agent.read.completed',
  'agent.read.failed',
  'agent.read.denied',
  'agent.write.started',
  'agent.write.completed',
  'agent.write.failed',
  'agent.write.denied',
  // Generic LangGraph node-execution markers (agent-internal; visibility
  // `internal`). Bounded metadata only: node name, iteration, duration,
  // outcome — never raw state, prompt text, SQL, or rows.
  'agent.node.started',
  'agent.node.completed',
  'agent.completed',
  'approval.required',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  // RBAC decision projections of the immutable `agent_audit_log` trail. Both
  // allow and deny are evented at `security` visibility (webhook audit channel
  // only, never the browser SSE stream). `agent.authz.*` is the agent-side
  // Layer-B re-gate; `authz.*` is the orchestrator gate.
  'authz.allowed',
  'authz.denied',
  'agent.authz.allowed',
  'agent.authz.denied',
  'artifact.created',
  'webhook.delivery.started',
  'webhook.delivery.succeeded',
  'webhook.delivery.failed',
  'run.completed',
  'run.failed',
  'run.canceled',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Webhook delivery lifecycle (transactional outbox, section 12). */
export const WEBHOOK_DELIVERY_STATUSES = [
  'pending',
  'in_progress',
  'succeeded',
  'failed',
  'dead_letter',
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** Terminal webhook delivery statuses (the dispatcher stops retrying). */
export const TERMINAL_WEBHOOK_DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = [
  'succeeded',
  'dead_letter',
];

/** Supported webhook authentication strategies (section 13). */
export const WEBHOOK_AUTH_TYPES = ['bearer', 'hmac', 'bearer_hmac'] as const;
export type WebhookAuthType = (typeof WEBHOOK_AUTH_TYPES)[number];

/** The single well-known org id used until the platform becomes multi-tenant. */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';
