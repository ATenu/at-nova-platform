import { randomUUID } from 'node:crypto';
import { MessageRole, type AgentRun } from '@nova/database';
import { NotFoundError, ValidationError, type Logger } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from '../users/current-user';
import type { UserRepository } from '../users/user.repository';
import type { ConversationRepository } from '../chat/conversation.repository';
import type { AgentRunRepository } from './agent-run.repository';
import type { OrchestratorClient } from './orchestrator-client';
import { buildEntitlementSnapshot } from './entitlement-snapshot';
import {
  toAgentRunDto,
  toAgentRunEventDto,
  type AgentRunDto,
  type AgentRunEventDto,
} from './agent-run.dto';
import type { CreateAgentRunBody } from './agent-run.schema';

const MAX_EVENT_BATCH = 200;

export interface AgentRunServiceConfig {
  /** Bounds how long an async run may keep acting for the user. */
  readonly runTtlSeconds: number;
}

export interface CreateAgentRunInput {
  readonly body: CreateAgentRunBody;
  readonly auth: AuthContext;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface EventBatch {
  readonly run: AgentRun;
  readonly events: readonly AgentRunEventDto[];
}

export class AgentRunService {
  constructor(
    private readonly runs: AgentRunRepository,
    private readonly users: UserRepository,
    private readonly conversations: ConversationRepository,
    private readonly config: AgentRunServiceConfig,
    private readonly logger: Logger,
    private readonly orchestrator: OrchestratorClient | null = null,
  ) {}

  /**
   * Submit a run. Captures the immutable entitlement snapshot from the validated
   * AuthContext, persists the run + snapshot to `postgres-agents`, and enqueues
   * the orchestration task by ID only. Idempotent per (ownerSubject, key).
   */
  async createRun(input: CreateAgentRunInput): Promise<AgentRunDto> {
    const { user } = await resolveCurrentUser(this.users, input.auth);
    const ownerSubject = input.auth.subject;

    const existing = await this.runs.findByOwnerAndIdempotencyKey(ownerSubject, input.idempotencyKey);
    if (existing) {
      return toAgentRunDto(existing);
    }

    // Reuse conversation/message persistence so the prompt lives in the business
    // DB (as for chat), never in postgres-agents and never on the broker.
    const conversation = input.body.conversationId
      ? await this.conversations.findForUser(input.body.conversationId, user.id)
      : await this.conversations.create(user.id);
    if (!conversation) {
      throw new NotFoundError('Conversation not found.');
    }
    const message = await this.conversations.addMessage({
      conversationId: conversation.id,
      role: MessageRole.USER,
      text: input.body.message,
      isMCPApps: false,
      MCPAppLink: null,
      MCPActive: null,
      createdDate: new Date(),
    });

    const snapshot = buildEntitlementSnapshot({
      ownerSubject,
      ownerUserId: user.id,
      roles: input.auth.roles,
      permissions: input.auth.permissions,
      ttlSeconds: this.config.runTtlSeconds,
    });

    const run = await this.runs.createRun({
      ownerSubject,
      ownerUserId: user.id,
      conversationId: conversation.id,
      promptRef: `nova-msg://${conversation.id}/${message.id}`,
      idempotencyKey: input.idempotencyKey,
      snapshot,
    });

    await this.enqueue(run, input.requestId, snapshot.snapshotHash);
    return toAgentRunDto(run);
  }

  async getRun(runId: string, auth: AuthContext): Promise<AgentRunDto> {
    const run = await this.requireOwnedRun(runId, auth);
    return toAgentRunDto(run);
  }

  async cancelRun(runId: string, auth: AuthContext): Promise<AgentRunDto> {
    const run = await this.requireOwnedRun(runId, auth);
    const updated = await this.runs.requestCancel(run);
    return toAgentRunDto(updated);
  }

  /** Ownership-checked batch read of user-visible events (used by the SSE loop). */
  async getEventBatch(runId: string, afterSequence: number, auth: AuthContext): Promise<EventBatch> {
    const run = await this.requireOwnedRun(runId, auth);
    const events = await this.runs.listUserEventsAfter(runId, afterSequence, MAX_EVENT_BATCH);
    return { run, events: events.map(toAgentRunEventDto) };
  }

  /** Default-deny ownership check: the run must belong to the caller's subject. */
  private async requireOwnedRun(runId: string, auth: AuthContext): Promise<AgentRun> {
    if (!auth.subject) {
      throw new ValidationError('Token is missing a subject.');
    }
    const run = await this.runs.findByIdForOwner(runId, auth.subject);
    if (!run) {
      // 404 (not 403) so cross-owner probing cannot distinguish existence.
      throw new NotFoundError('Agent run not found.');
    }
    return run;
  }

  private async enqueue(run: AgentRun, requestId: string, snapshotHash: string): Promise<void> {
    if (!this.orchestrator) {
      this.logger.warn({ runId: run.id }, 'orchestrator client not configured; run left queued');
      return;
    }
    try {
      await this.orchestrator.enqueueRun({
        runId: run.id,
        requestId: requestId || randomUUID(),
        idempotencyKey: run.idempotencyKey,
        actingSubject: run.ownerSubject,
        entitlementSnapshotId: run.entitlementSnapshotId,
        entitlementSnapshotHash: snapshotHash,
      });
    } catch (error) {
      // Enqueue is best-effort here; the run is durably `queued` and can be
      // dispatched by the gateway. Never leak error internals.
      this.logger.warn(
        { runId: run.id, reason: error instanceof Error ? error.name : 'unknown' },
        'failed to enqueue run with orchestrator',
      );
    }
  }
}
