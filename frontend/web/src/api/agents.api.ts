import { http } from './httpClient';
import type { AgentRegistrationDto, OnboardAgentRequest } from './types';

/**
 * Admin agent-registry API. All `/admin/agents/*` routes run behind the
 * centralized auth pipeline (`read-agents` / `write-agents`). Onboarding hands
 * the orchestrator a host URL; the platform fetches the Agent Card over native
 * A2A — the card is never hand-entered. Mock mode mirrors this contract.
 */

export function listAgents(): Promise<readonly AgentRegistrationDto[]> {
  return http.get<readonly AgentRegistrationDto[]>('/admin/agents');
}

export function getAgent(name: string): Promise<AgentRegistrationDto> {
  return http.get<AgentRegistrationDto>(`/admin/agents/${encodeURIComponent(name)}`);
}

export function onboardAgent(body: OnboardAgentRequest): Promise<AgentRegistrationDto> {
  return http.post<AgentRegistrationDto>('/admin/agents/onboard', body);
}

export function setAgentEnabled(name: string, enabled: boolean): Promise<AgentRegistrationDto> {
  return http.patch<AgentRegistrationDto>(`/admin/agents/${encodeURIComponent(name)}`, { enabled });
}

export function removeAgent(name: string): Promise<void> {
  return http.delete<void>(`/admin/agents/${encodeURIComponent(name)}`);
}
