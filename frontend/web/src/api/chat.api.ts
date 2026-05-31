import { http } from './httpClient';
import type { ConversationDto } from './types';

/**
 * Conversation API (`GET/POST /conversations`, `GET /conversations/:id`). The
 * backend persists conversations; agent turns are produced asynchronously by the
 * orchestration execution plane. Sending a message creates an agent run via the
 * chat entrypoint — see `createAgentRun` in `agentRuns.api`.
 */
export function listConversations(): Promise<readonly ConversationDto[]> {
  return http.get<readonly ConversationDto[]>('/conversations');
}

export function getConversation(id: string): Promise<ConversationDto> {
  return http.get<ConversationDto>(`/conversations/${id}`);
}

export function createConversation(): Promise<ConversationDto> {
  return http.post<ConversationDto>('/conversations');
}
