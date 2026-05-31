import type { AgentRun, AgentRunEvent } from '@nova/database';

export interface AgentRunDto {
  readonly runId: string;
  readonly status: string;
  readonly conversationId: string | null;
  readonly cancelRequested: boolean;
  readonly finalResponse: string | null;
  /**
   * Id of the assistant message this run finalized to (parsed from the internal
   * response reference), or `null` if not yet finalized. Lets the client map a
   * persisted conversation message back to its run trace. Never the ref itself.
   */
  readonly responseMessageId: string | null;
  readonly eventsUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface AgentRunEventDto {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

/** Full ordered `user`-visibility trace for one run (tool/agent calls + IO). */
export interface AgentRunTraceDto {
  readonly runId: string;
  readonly status: string;
  readonly events: readonly AgentRunEventDto[];
}

export function eventsUrlFor(runId: string): string {
  return `/api/v1/agent-runs/${runId}/events`;
}

/**
 * Extract the assistant message id from an internal response reference of the
 * form `nova-msg://{conversationId}/{messageId}`. Returns `null` for an unset or
 * malformed ref; the ref itself is never exposed to clients.
 */
function responseMessageIdFrom(responseRef: string | null): string | null {
  if (!responseRef) {
    return null;
  }
  const messageId = responseRef.split('/').pop();
  return messageId && messageId.length > 0 ? messageId : null;
}

export function toAgentRunDto(run: AgentRun): AgentRunDto {
  return {
    runId: run.id,
    status: run.status,
    conversationId: run.conversationId,
    cancelRequested: run.cancelRequested,
    // The final response is referenced from object storage; surfaced once a
    // resolver is wired. Never serialize the prompt/response refs themselves.
    finalResponse: null,
    responseMessageId: responseMessageIdFrom(run.responseRef),
    eventsUrl: eventsUrlFor(run.id),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    expiresAt: run.expiresAt ? run.expiresAt.toISOString() : null,
  };
}

export function toAgentRunEventDto(event: AgentRunEvent): AgentRunEventDto {
  return {
    id: event.id,
    sequence: Number(event.sequence),
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}
