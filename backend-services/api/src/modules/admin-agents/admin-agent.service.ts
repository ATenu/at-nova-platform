import { RbacAuditLog } from '@nova/database';
import { ConflictError, NotFoundError, ValidationError, type Logger } from '@nova/shared';
import type { DataSource } from 'typeorm';
import {
  OrchestratorClientError,
  type OnboardAgentPayload,
  type OrchestratorClient,
} from '../agent-runs/orchestrator-client';
import { toAgentRegistrationDto, type AgentRegistrationDto } from './admin-agent.dto';
import type { AdminAgentRepository } from './admin-agent.repository';
import type { OnboardAgentBody } from './admin-agent.schema';

export interface AgentActor {
  readonly subject: string;
  readonly userId: string | null;
}

export interface OnboardAgentInput extends OnboardAgentBody {
  readonly requestId?: string | undefined;
}

interface AuditEntry {
  readonly action: string;
  readonly targetId: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Business rules for the admin agent-registry surface. Reads + pure-metadata
 * mutations run against the agents DB; onboarding (native A2A card fetch + SSRF
 * + skill derivation + persist) is delegated to the orchestrator so admin
 * onboarding is literally the same code path as self-registration. Every
 * mutation is written to the RBAC audit log. Default deny and source-ownership
 * protection are enforced here, never in controllers.
 */
export class AdminAgentService {
  constructor(
    private readonly repository: AdminAgentRepository,
    private readonly auditDataSource: DataSource,
    private readonly orchestrator: OrchestratorClient | null,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<readonly AgentRegistrationDto[]> {
    const rows = await this.repository.list();
    return rows.map(toAgentRegistrationDto);
  }

  async get(name: string): Promise<AgentRegistrationDto> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundError('Agent not found.');
    }
    return toAgentRegistrationDto(row);
  }

  async onboard(actor: AgentActor, input: OnboardAgentInput): Promise<AgentRegistrationDto> {
    if (!this.orchestrator) {
      // Onboarding requires the native A2A fetch path in the execution plane.
      throw new ValidationError('Agent onboarding is not available in this deployment.');
    }

    const payload: OnboardAgentPayload = {
      hostUrl: input.hostUrl,
      audience: input.audience,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      onboardedBy: actor.subject,
    };

    let result;
    try {
      result = await this.orchestrator.onboardAgent(payload, input.requestId);
    } catch (error) {
      await this.recordAudit(actor, {
        action: 'agent.onboard.failed',
        targetId: input.name ?? input.hostUrl,
        details: { hostUrl: input.hostUrl, reason: failureReason(error) },
      });
      throw this.translateOnboardError(error);
    }

    await this.recordAudit(actor, {
      action: 'agent.onboard',
      targetId: result.name,
      details: {
        hostUrl: result.baseUrl,
        audience: result.audience,
        skillIds: [...result.skillIds],
        source: 'admin',
      },
    });

    const row = await this.repository.findByName(result.name);
    if (!row) {
      // The orchestrator persisted it; a missing read indicates a serious
      // consistency problem rather than a client error.
      throw new NotFoundError('Onboarded agent could not be read back.');
    }
    return toAgentRegistrationDto(row);
  }

  async setEnabled(
    actor: AgentActor,
    name: string,
    enabled: boolean,
  ): Promise<AgentRegistrationDto> {
    const row = await this.requireAdminSourceRow(name);
    await this.repository.setEnabled(name, enabled);
    await this.recordAudit(actor, {
      action: enabled ? 'agent.enable' : 'agent.disable',
      targetId: name,
    });
    const updated = await this.repository.findByName(name);
    return toAgentRegistrationDto(updated ?? row);
  }

  async remove(actor: AgentActor, name: string): Promise<void> {
    await this.requireAdminSourceRow(name);
    await this.repository.remove(name);
    await this.recordAudit(actor, { action: 'agent.remove', targetId: name });
  }

  /** Load a row, enforcing that it exists and is operator-managed (admin source). */
  private async requireAdminSourceRow(name: string) {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundError('Agent not found.');
    }
    if (row.source !== 'admin') {
      // Self-registered agents are governed by their own heartbeat/deregister
      // lifecycle and must not be mutated through the admin surface.
      throw new ConflictError('Self-registered agents cannot be managed here.');
    }
    return row;
  }

  private translateOnboardError(error: unknown): Error {
    if (error instanceof OrchestratorClientError) {
      if (error.status === 409) {
        return new ConflictError('An agent with this name is already self-registered.');
      }
      if (error.status === 400) {
        return new ValidationError(
          'The host URL is invalid or the agent card advertises no routable skills.',
        );
      }
    }
    // Unreachable / unparseable card / timeout / orchestrator unavailable: a
    // coarse, non-leaky message (never the raw upstream body).
    return new ValidationError('The agent card could not be retrieved from the host URL.');
  }

  private async recordAudit(actor: AgentActor, entry: AuditEntry): Promise<void> {
    try {
      await this.auditDataSource.getRepository(RbacAuditLog).insert({
        actorSubject: actor.subject,
        actorUserId: actor.userId,
        action: entry.action,
        targetType: 'agent',
        targetId: entry.targetId,
        ...(entry.details !== undefined ? { details: entry.details } : {}),
      });
    } catch (error) {
      // Auditing is best-effort relative to the operation it records; a failed
      // audit write must not mask a successful mutation, but is logged loudly.
      this.logger.error(
        { action: entry.action, reason: error instanceof Error ? error.name : 'unknown' },
        'failed to write agent audit row',
      );
    }
  }
}

function failureReason(error: unknown): string {
  if (error instanceof OrchestratorClientError && typeof error.status === 'number') {
    if (error.status === 409) return 'name conflict';
    if (error.status === 400) return 'invalid host or no skills';
    return 'unreachable';
  }
  return 'unreachable';
}
