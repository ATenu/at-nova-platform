import { ConflictError, NotFoundError, ValidationError, type Logger } from '@nova/shared';
import type { A2aAgentRegistration } from '@nova/database';
import type { DataSource } from 'typeorm';
import {
  OrchestratorClientError,
  type OnboardAgentPayload,
  type OnboardAgentResult,
  type OrchestratorClient,
} from '../agent-runs/orchestrator-client';
import { AdminAgentService } from './admin-agent.service';
import type { AdminAgentRepository } from './admin-agent.repository';

const actor = { subject: 'kc-admin', userId: null };

function fakeRow(overrides: Partial<A2aAgentRegistration> = {}): A2aAgentRegistration {
  return {
    name: 'at-usecase-x',
    baseUrl: 'https://usecase-x.internal:8443',
    audience: 'nova-agent-usecase-x',
    card: { skills: [{ id: 'data.analyse.read', name: 'Analyse', description: '' }] },
    skillIds: ['data.analyse.read'],
    source: 'admin',
    status: 'onboarded',
    enabled: true,
    displayName: 'Use-case X',
    description: null,
    version: '1.0.0',
    tags: [],
    onboardedBy: 'kc-admin',
    onboardedAt: new Date('2026-06-01T00:00:00.000Z'),
    lastCardFetchAt: new Date('2026-06-01T00:00:00.000Z'),
    consecutiveFailures: 0,
    lastError: null,
    registeredAt: new Date('2026-06-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  } as A2aAgentRegistration;
}

const onboardResult: OnboardAgentResult = {
  name: 'at-usecase-x',
  baseUrl: 'https://usecase-x.internal:8443',
  audience: 'nova-agent-usecase-x',
  skillIds: ['data.analyse.read'],
  version: '1.0.0',
  status: 'onboarded',
  card: { skills: [{ id: 'data.analyse.read' }] },
};

function build(parts: {
  repo?: Partial<AdminAgentRepository>;
  orchestrator?: OrchestratorClient | null;
}) {
  const insert = jest.fn(async () => undefined);
  const auditDataSource = {
    getRepository: jest.fn(() => ({ insert })),
  } as unknown as DataSource;
  const repo = {
    list: jest.fn(async () => [fakeRow()]),
    findByName: jest.fn(async () => fakeRow()),
    setEnabled: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    ...parts.repo,
  } as unknown as AdminAgentRepository;
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as unknown as Logger;
  const service = new AdminAgentService(
    repo,
    auditDataSource,
    parts.orchestrator === undefined ? null : parts.orchestrator,
    logger,
  );
  return { service, repo, insert };
}

describe('AdminAgentService.onboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delegates to the orchestrator, audits success, and maps the DTO', async () => {
    const onboardAgent = jest.fn(async (_p: OnboardAgentPayload, _r?: string) => onboardResult);
    const orchestrator = { onboardAgent } as unknown as OrchestratorClient;
    const { service, insert } = build({ orchestrator });

    const dto = await service.onboard(actor, {
      hostUrl: 'https://usecase-x.internal:8443',
      audience: 'nova-agent-usecase-x',
    });

    expect(onboardAgent).toHaveBeenCalledTimes(1);
    expect(onboardAgent.mock.calls[0]![0]).toMatchObject({ onboardedBy: 'kc-admin' });
    expect(dto.name).toBe('at-usecase-x');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.onboard', targetType: 'agent' }));
  });

  it('maps an orchestrator 400 to a ValidationError and writes a failed audit', async () => {
    const onboardAgent = jest.fn(async () => {
      throw new OrchestratorClientError('bad', 400);
    });
    const orchestrator = { onboardAgent } as unknown as OrchestratorClient;
    const { service, insert } = build({ orchestrator });

    await expect(
      service.onboard(actor, { hostUrl: 'https://x.internal', audience: 'nova-agent-x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.onboard.failed' }));
  });

  it('maps an orchestrator 502 (unreachable) to a sanitised ValidationError', async () => {
    const onboardAgent = jest.fn(async () => {
      throw new OrchestratorClientError('unreachable', 502);
    });
    const orchestrator = { onboardAgent } as unknown as OrchestratorClient;
    const { service } = build({ orchestrator });

    await expect(
      service.onboard(actor, { hostUrl: 'https://x.internal', audience: 'nova-agent-x' }),
    ).rejects.toMatchObject({ category: 'validation', detail: expect.stringMatching(/could not be retrieved/i) });
  });

  it('maps a name collision (409) to a ConflictError', async () => {
    const onboardAgent = jest.fn(async () => {
      throw new OrchestratorClientError('conflict', 409);
    });
    const orchestrator = { onboardAgent } as unknown as OrchestratorClient;
    const { service } = build({ orchestrator });

    await expect(
      service.onboard(actor, { hostUrl: 'https://x.internal', audience: 'nova-agent-x' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('fails closed when no orchestrator is configured', async () => {
    const { service } = build({ orchestrator: null });
    await expect(
      service.onboard(actor, { hostUrl: 'https://x.internal', audience: 'nova-agent-x' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('AdminAgentService mutations (source ownership)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects enabling a self-registered agent', async () => {
    const { service } = build({ repo: { findByName: jest.fn(async () => fakeRow({ source: 'self' })) } });
    await expect(service.setEnabled(actor, 'at-sql-analyser', false)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects removing a self-registered agent', async () => {
    const { service } = build({ repo: { findByName: jest.fn(async () => fakeRow({ source: 'self' })) } });
    await expect(service.remove(actor, 'at-sql-analyser')).rejects.toBeInstanceOf(ConflictError);
  });

  it('disables an admin agent and audits it', async () => {
    const { service, repo, insert } = build({});
    await service.setEnabled(actor, 'at-usecase-x', false);
    expect(repo.setEnabled).toHaveBeenCalledWith('at-usecase-x', false);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.disable' }));
  });

  it('removes an admin agent and audits it', async () => {
    const { service, repo, insert } = build({});
    await service.remove(actor, 'at-usecase-x');
    expect(repo.remove).toHaveBeenCalledWith('at-usecase-x');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.remove' }));
  });

  it('throws NotFound for a missing agent', async () => {
    const { service } = build({ repo: { findByName: jest.fn(async () => null) } });
    await expect(service.setEnabled(actor, 'missing', true)).rejects.toBeInstanceOf(NotFoundError);
  });
});
