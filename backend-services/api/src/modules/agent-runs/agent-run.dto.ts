import type { AgentRun, AgentRunEvent } from '@nova/database';

export interface AgentRunDto {
  readonly runId: string;
  readonly status: string;
  readonly conversationId: string | null;
  readonly cancelRequested: boolean;
  readonly finalResponse: string | null;
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

export function eventsUrlFor(runId: string): string {
  return `/api/v1/agent-runs/${runId}/events`;
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
