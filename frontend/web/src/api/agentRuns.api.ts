import { http } from './httpClient';
import type { AgentRunDto, CreateAgentRunRequest } from './types';

/**
 * Asynchronous agent-run control plane. The chat entrypoint (`POST /a2a/chat`)
 * creates a run and returns `202 Accepted` with the run handle; progress is then
 * streamed over SSE via `useAgentRunEvents`, the run resource is read at
 * `/agent-runs/:runId`, and cancellation is best-effort (the worker honours it at
 * the next safe checkpoint). The user prompt is persisted server-side; no tokens
 * or entitlement data ever cross this boundary.
 */

/** A stable per-submission key so retries never enqueue a duplicate run. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function createAgentRun(
  body: CreateAgentRunRequest,
  idempotencyKey: string,
): Promise<AgentRunDto> {
  return http.post<AgentRunDto>('/a2a/chat', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function getAgentRun(runId: string): Promise<AgentRunDto> {
  return http.get<AgentRunDto>(`/agent-runs/${runId}`);
}

export function cancelAgentRun(runId: string): Promise<AgentRunDto> {
  return http.post<AgentRunDto>(`/agent-runs/${runId}/cancel`);
}
