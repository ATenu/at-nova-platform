import {
  AgentRun,
  AgentRunEntitlement,
  AgentRunEvent,
  TERMINAL_AGENT_RUN_STATUSES,
  type AgentRunStatus,
} from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { EntitlementSnapshot } from './entitlement-snapshot';

/** Page size used when collecting a run's full user-visibility event trace. */
const USER_EVENT_PAGE_SIZE = 200;

export interface CreateAgentRunData {
  readonly ownerSubject: string;
  readonly ownerUserId: string;
  readonly conversationId: string | null;
  readonly promptRef: string;
  readonly idempotencyKey: string;
  readonly snapshot: EntitlementSnapshot;
}

/**
 * Data access for the isolated orchestration-state database (`postgres-agents`).
 * The control plane writes runs + immutable entitlement snapshots here; it never
 * touches the business `nova` database for orchestration state.
 */
export interface RunWithEntitlement {
  readonly run: AgentRun;
  readonly entitlement: AgentRunEntitlement;
}

export interface ToolAuditInput {
  readonly runId: string;
  readonly ownerSubject: string;
  readonly actor: string;
  readonly action: string;
  readonly capability: string | null;
  readonly decision: 'allow' | 'deny';
  readonly reason: string | null;
  readonly correlationId?: string | null;
}

export class AgentRunRepository {
  private readonly runs: Repository<AgentRun>;
  private readonly events: Repository<AgentRunEvent>;
  private readonly entitlements: Repository<AgentRunEntitlement>;

  constructor(private readonly dataSource: DataSource) {
    this.runs = dataSource.getRepository(AgentRun);
    this.events = dataSource.getRepository(AgentRunEvent);
    this.entitlements = dataSource.getRepository(AgentRunEntitlement);
  }

  /** Insert the entitlement snapshot and the run atomically (status `queued`). */
  async createRun(data: CreateAgentRunData): Promise<AgentRun> {
    return this.dataSource.transaction(async (manager) => {
      const entitlementRepo = manager.getRepository(AgentRunEntitlement);
      const runRepo = manager.getRepository(AgentRun);

      const entitlement = await entitlementRepo.save(
        entitlementRepo.create({
          ownerSubject: data.snapshot.ownerSubject,
          ownerUserId: data.snapshot.ownerUserId,
          roles: [...data.snapshot.roles],
          permissions: [...data.snapshot.permissions],
          capabilityAllowlist: [...data.snapshot.capabilityAllowlist],
          snapshotHash: data.snapshot.snapshotHash,
          issuedAt: data.snapshot.issuedAt,
          expiresAt: data.snapshot.expiresAt,
        }),
      );

      const run = await runRepo.save(
        runRepo.create({
          ownerSubject: data.ownerSubject,
          ownerUserId: data.ownerUserId,
          conversationId: data.conversationId,
          status: 'queued' satisfies AgentRunStatus,
          promptRef: data.promptRef,
          responseRef: null,
          callbackAuthConfigId: null,
          entitlementSnapshotId: entitlement.id,
          idempotencyKey: data.idempotencyKey,
          cancelRequested: false,
          lastHeartbeatAt: null,
          expiresAt: data.snapshot.expiresAt,
        }),
      );
      return run;
    });
  }

  /** Load a run only if it belongs to the given owner subject (ownership check). */
  async findByIdForOwner(runId: string, ownerSubject: string): Promise<AgentRun | null> {
    return this.runs.findOne({ where: { id: runId, ownerSubject } });
  }

  /**
   * Load a run together with its immutable entitlement snapshot. Used by the
   * internal MCP tool gateway, which acts via `runId` (no owner header to
   * trust) and re-verifies the snapshot before executing any capability.
   */
  async findRunWithEntitlement(runId: string): Promise<RunWithEntitlement | null> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) {
      return null;
    }
    const entitlement = await this.entitlements.findOne({
      where: { id: run.entitlementSnapshotId },
    });
    if (!entitlement) {
      return null;
    }
    return { run, entitlement };
  }

  /** Persist the final response reference (set by the worker via finalize). */
  async setResponseRef(runId: string, responseRef: string): Promise<void> {
    await this.runs.update({ id: runId }, { responseRef });
  }

  /**
   * Append-only audit row. The tool gateway records its independent allow/deny
   * decision here (defense in depth) so the agents DB holds the authoritative
   * security trail for the execution plane. Written via a parameterized insert
   * (no dedicated entity to keep the registered entity set minimal).
   */
  async recordToolAudit(input: ToolAuditInput): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "agent_audit_log"
        ("run_id", "owner_subject", "actor", "action", "capability", "decision", "reason", "correlation_id", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        input.runId,
        input.ownerSubject,
        input.actor,
        input.action,
        input.capability,
        input.decision,
        input.reason,
        input.correlationId ?? null,
      ],
    );
  }

  async findByOwnerAndIdempotencyKey(
    ownerSubject: string,
    idempotencyKey: string,
  ): Promise<AgentRun | null> {
    return this.runs.findOne({ where: { ownerSubject, idempotencyKey } });
  }

  /**
   * Owner-scoped list of a conversation's runs (default deny: only the caller's
   * own runs are ever returned). Used to map each persisted assistant message
   * back to the run whose trace produced it.
   */
  async listForOwnerAndConversation(
    ownerSubject: string,
    conversationId: string,
  ): Promise<AgentRun[]> {
    return this.runs.find({
      where: { ownerSubject, conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * All `user`-visibility events for a run, in order. Paginates internally so a
   * long trace is fully returned. `internal`/`security` events never leave here.
   */
  async listAllUserEvents(runId: string): Promise<AgentRunEvent[]> {
    const all: AgentRunEvent[] = [];
    let afterSequence = 0;
    for (;;) {
      const batch = await this.listUserEventsAfter(runId, afterSequence, USER_EVENT_PAGE_SIZE);
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
      afterSequence = Number(batch[batch.length - 1]!.sequence);
      if (batch.length < USER_EVENT_PAGE_SIZE) {
        break;
      }
    }
    return all;
  }

  /**
   * Stream-facing read: only `user`-visibility events strictly after the given
   * sequence, ordered ascending. `internal`/`security` events never leave here.
   */
  async listUserEventsAfter(
    runId: string,
    afterSequence: number,
    limit: number,
  ): Promise<AgentRunEvent[]> {
    return this.events
      .createQueryBuilder('event')
      .where('event.run_id = :runId', { runId })
      .andWhere('event.visibility = :visibility', { visibility: 'user' })
      .andWhere('event.sequence > :afterSequence', { afterSequence })
      .orderBy('event.sequence', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Request cooperative cancellation. No-op (returns the current row) when the
   * run is already terminal. The worker checks the flag between steps.
   */
  async requestCancel(run: AgentRun): Promise<AgentRun> {
    if (TERMINAL_AGENT_RUN_STATUSES.includes(run.status) || run.cancelRequested) {
      return run;
    }
    await this.runs.update({ id: run.id }, { cancelRequested: true });
    run.cancelRequested = true;
    return run;
  }
}
