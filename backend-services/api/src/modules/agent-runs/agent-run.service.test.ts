import { NotFoundError, permissionsForRoles, type Logger, type Role } from '@nova/shared';
import type { AgentRun } from '@nova/database';
import type { AuthContext } from '../../auth/auth-context';
import { AgentRunService } from './agent-run.service';
import type { AgentRunRepository } from './agent-run.repository';
import type { UserRepository } from '../users/user.repository';
import type { ConversationRepository } from '../chat/conversation.repository';
import type { EnqueueRunPayload, OrchestratorClient } from './orchestrator-client';

function authFor(subject: string, roles: Role[]): AuthContext {
  return {
    subject,
    issuer: 'https://keycloak.local/realms/nova',
    audience: ['nova-api'],
    email: `${subject}@test.com`,
    username: subject,
    givenName: 'Test',
    familyName: 'User',
    roles,
    permissions: permissionsForRoles(roles),
    scopes: [],
  };
}

function fakeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    ownerSubject: 'kc-1',
    ownerUserId: 'user-1',
    orgId: '00000000-0000-0000-0000-000000000000',
    conversationId: 'conv-1',
    status: 'queued',
    promptRef: 'nova-msg://conv-1/msg-1',
    responseRef: null,
    callbackAuthConfigId: null,
    entitlementSnapshotId: 'ent-1',
    idempotencyKey: 'idem-1',
    cancelRequested: false,
    lastHeartbeatAt: null,
    expiresAt: new Date('2026-05-31T02:00:00.000Z'),
    createdAt: new Date('2026-05-31T00:00:00.000Z'),
    updatedAt: new Date('2026-05-31T00:00:00.000Z'),
    entitlement: undefined as never,
    ...overrides,
  } as AgentRun;
}

const logger = { warn: jest.fn(), info: jest.fn() } as unknown as Logger;

function buildService(parts: {
  runs?: Partial<AgentRunRepository>;
  orchestrator?: OrchestratorClient | null;
}) {
  const users = {
    findByKeycloakId: jest.fn(async (sub: string) => ({ user: { id: 'user-1', keycloakId: sub }, roles: ['sales-user'] })),
  } as unknown as UserRepository;
  const conversations = {
    create: jest.fn(async () => ({ id: 'conv-1', userId: 'user-1' })),
    findForUser: jest.fn(async (id: string) => ({ id, userId: 'user-1' })),
    addMessage: jest.fn(async () => ({ id: 'msg-1' })),
  } as unknown as ConversationRepository;
  const runs = {
    findByOwnerAndIdempotencyKey: jest.fn(async () => null),
    createRun: jest.fn(async () => fakeRun()),
    findByIdForOwner: jest.fn(async (runId: string, ownerSubject: string) =>
      ownerSubject === 'kc-1' ? fakeRun({ id: runId }) : null,
    ),
    requestCancel: jest.fn(async (run: AgentRun) => ({ ...run, cancelRequested: true })),
    listUserEventsAfter: jest.fn(async () => []),
    listForOwnerAndConversation: jest.fn(async () => []),
    listAllUserEvents: jest.fn(async () => []),
    ...parts.runs,
  } as unknown as AgentRunRepository;

  const service = new AgentRunService(
    runs,
    users,
    conversations,
    { runTtlSeconds: 7200 },
    logger,
    parts.orchestrator ?? null,
  );
  return { service, runs, conversations, users };
}

describe('AgentRunService.createRun', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures an entitlement snapshot and enqueues by ID only', async () => {
    const enqueueRun = jest.fn(async (_payload: EnqueueRunPayload) => undefined);
    const orchestrator = { enqueueRun } as unknown as OrchestratorClient;
    const { service } = buildService({ orchestrator });

    const dto = await service.createRun({
      body: { message: 'add a sale' },
      auth: authFor('kc-1', ['sales-user']),
      idempotencyKey: 'idem-1',
      requestId: 'req-1',
    });

    expect(dto.runId).toBe('run-1');
    expect(dto.status).toBe('queued');
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const payload = enqueueRun.mock.calls[0]![0];
    expect(payload.actingSubject).toBe('kc-1');
    expect(payload.entitlementSnapshotHash).toMatch(/^sha256:/);
    // The prompt is never put on the broker payload.
    expect(JSON.stringify(payload)).not.toContain('add a sale');
  });

  it('is idempotent: a replayed key returns the existing run without re-enqueue', async () => {
    const enqueueRun = jest.fn(async (_payload: EnqueueRunPayload) => undefined);
    const orchestrator = { enqueueRun } as unknown as OrchestratorClient;
    const { service } = buildService({
      runs: { findByOwnerAndIdempotencyKey: jest.fn(async () => fakeRun({ id: 'existing' })) },
      orchestrator,
    });

    const dto = await service.createRun({
      body: { message: 'hi' },
      auth: authFor('kc-1', ['sales-user']),
      idempotencyKey: 'idem-1',
      requestId: 'req-1',
    });

    expect(dto.runId).toBe('existing');
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('still persists the run when no orchestrator is configured', async () => {
    const { service, runs } = buildService({ orchestrator: null });
    const dto = await service.createRun({
      body: { message: 'hi' },
      auth: authFor('kc-1', ['sales-user']),
      idempotencyKey: 'idem-1',
      requestId: 'req-1',
    });
    expect(dto.status).toBe('queued');
    expect(runs.createRun).toHaveBeenCalledTimes(1);
  });
});

describe('AgentRunService ownership (default deny)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an owned run', async () => {
    const { service } = buildService({});
    const dto = await service.getRun('run-9', authFor('kc-1', ['sales-user']));
    expect(dto.runId).toBe('run-9');
  });

  it('rejects cross-owner reads with 404 (no existence disclosure)', async () => {
    const { service } = buildService({});
    await expect(service.getRun('run-9', authFor('kc-OTHER', ['sales-user']))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects cross-owner cancel', async () => {
    const { service } = buildService({});
    await expect(
      service.cancelRun('run-9', authFor('kc-OTHER', ['sales-user'])),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects cross-owner event reads', async () => {
    const { service } = buildService({});
    await expect(
      service.getEventBatch('run-9', 0, authFor('kc-OTHER', ['sales-user'])),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects cross-owner trace reads with 404', async () => {
    const { service } = buildService({});
    await expect(
      service.getRunTrace('run-9', authFor('kc-OTHER', ['sales-user'])),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns an owned run trace with only its user-visibility events by default', async () => {
    const listAllUserEvents = jest.fn(async () => [
      {
        id: 'evt-1',
        sequence: 1,
        type: 'tool.call.completed',
        payload: { capability: 'sales.read', input: {}, output: { rows: 1 } },
        createdAt: new Date('2026-05-31T00:00:01.000Z'),
      },
    ]);
    const { service } = buildService({
      runs: { listAllUserEvents } as unknown as Partial<AgentRunRepository>,
    });
    const trace = await service.getRunTrace('run-9', authFor('kc-1', ['sales-user']));
    expect(trace.runId).toBe('run-9');
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]!.type).toBe('tool.call.completed');
    // Default scope: `user`-visibility only (no internal/security events).
    expect(listAllUserEvents).toHaveBeenCalledWith('run-9', false);
  });

  it('includes internal/security events in the trace only when detailed is requested', async () => {
    const listAllUserEvents = jest.fn(async () => []);
    const { service } = buildService({
      runs: { listAllUserEvents } as unknown as Partial<AgentRunRepository>,
    });
    await service.getRunTrace('run-9', authFor('kc-1', ['sales-user']), true);
    // The owner opted into the full technical timeline (node + authz events).
    expect(listAllUserEvents).toHaveBeenCalledWith('run-9', true);
  });

  it('passes the detailed flag through to the event batch read', async () => {
    const listUserEventsAfter = jest.fn(async () => []);
    const { service } = buildService({
      runs: { listUserEventsAfter } as unknown as Partial<AgentRunRepository>,
    });
    await service.getEventBatch('run-9', 5, authFor('kc-1', ['sales-user']), true);
    expect(listUserEventsAfter).toHaveBeenCalledWith('run-9', 5, expect.any(Number), true);
  });
});

describe('AgentRunService.listRunsForConversation (owner-scoped)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scopes the query to the caller subject and exposes the response message id', async () => {
    const listForOwnerAndConversation = jest.fn(async () => [
      fakeRun({ id: 'run-a', responseRef: 'nova-msg://conv-1/msg-42' }),
      fakeRun({ id: 'run-b', responseRef: null }),
    ]);
    const { service } = buildService({
      runs: { listForOwnerAndConversation } as unknown as Partial<AgentRunRepository>,
    });

    const dtos = await service.listRunsForConversation('conv-1', authFor('kc-1', ['sales-user']));

    expect(listForOwnerAndConversation).toHaveBeenCalledWith('kc-1', 'conv-1');
    expect(dtos).toHaveLength(2);
    expect(dtos[0]!.responseMessageId).toBe('msg-42');
    // A not-yet-finalized run exposes no message link and never leaks the ref.
    expect(dtos[1]!.responseMessageId).toBeNull();
    expect(JSON.stringify(dtos)).not.toContain('nova-msg://');
  });
});
