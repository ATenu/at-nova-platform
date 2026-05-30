import { http } from './httpClient';
import type { AgentChatRequest, AgentChatResponse, ConversationDto } from './types';

/**
 * Chat / A2A agent API. The agent endpoint persists the user message, runs the
 * Nova agent, and returns the conversation, the assistant message, and any
 * resolved tool/deep links.
 *
 * Backed by `GET/POST /conversations`, `GET /conversations/:id`, and
 * `POST /a2a/chat`. The backend persists conversations and delegates reasoning
 * to a pluggable agent gateway (a local deterministic agent until the LangGraph
 * A2A agent is wired in). Mock mode mirrors this contract.
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

export function sendAgentMessage(body: AgentChatRequest): Promise<AgentChatResponse> {
  return http.post<AgentChatResponse>('/a2a/chat', body);
}
