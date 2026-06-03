import { ForbiddenError, NotFoundError } from '@nova/shared';
import { MessageRole, type AgentRunEntitlement } from '@nova/database';
import type { Logger } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { getActiveRegistry } from '../../rbac/registry-holder';
import type { ConversationRepository } from '../chat/conversation.repository';
import type { AgentToolLink } from './agent-links';
import type { AgentRunRepository } from './agent-run.repository';
import { computeSnapshotHash } from './entitlement-snapshot';
import { CapabilityExecutor, type ToolCallResult } from './capability-executor';

const WORKER_ACTOR = 'nova-celery-worker';

export interface ExecuteCapabilityInput {
  readonly runId: string;
  readonly capabilityId: string;
  readonly input: unknown;
}

export interface FinalizeRunInput {
  readonly runId: string;
  readonly text: string;
  readonly links: readonly AgentToolLink[];
}

export interface FinalizeResult {
  readonly responseRef: string;
}

/**
 * Minimal, verified entitlement view returned by the internal entitlement
 * read-back endpoint (decision D2). Carries only what a downstream resource
 * server needs to re-enforce authorization and set the per-session ownership
 * GUC — never tokens, prompts, rows, or other PII.
 */
export interface EntitlementView {
  readonly runId: string;
  readonly ownerSubject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly snapshotHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Internal MCP tool gateway (the Node-hosted resource server for Nova's sales /
 * customers / issues / actions / SOP tools, audience `nova-mcp-*`). Reached only
 * by the Celery worker with an audience-restricted service token. It
 * independently re-enforces authorization against the immutable entitlement
 * snapshot — never trusting the worker — and executes the capability through the
 * existing permission-gated business services. Default deny throughout.
 */
export class ToolGatewayService {
  private readonly executor: CapabilityExecutor;

  constructor(
    private readonly runs: AgentRunRepository,
    private readonly conversations: ConversationRepository,
    executorServices: ConstructorParameters<typeof CapabilityExecutor>[0],
    private readonly logger: Logger,
  ) {
    this.executor = new CapabilityExecutor(executorServices);
  }

  /**
   * Return the user's prompt for a run. The prompt lives only in the business
   * conversation (never on the broker or in postgres-agents); the worker fetches
   * it here over an authenticated channel for planning.
   */
  async getPrompt(runId: string): Promise<{ message: string }> {
    const { run } = await this.loadVerified(runId);
    if (!run.conversationId) {
      throw new NotFoundError('Run has no associated conversation.');
    }
    const messageId = run.promptRef.split('/').pop() ?? '';
    const message = await this.conversations.findMessageInConversation(run.conversationId, messageId);
    if (!message) {
      throw new NotFoundError('Prompt message not found.');
    }
    return { message: message.text };
  }

  async executeCapability(input: ExecuteCapabilityInput): Promise<ToolCallResult> {
    const { run, entitlement } = await this.loadVerified(input.runId);

    const registry = getActiveRegistry();
    const capability = registry.getCapability(input.capabilityId);
    const permissionSet = new Set<string>(entitlement.permissions);
    if (!capability || !registry.permissionsSatisfyCapability(capability, permissionSet)) {
      // Independent default-deny check (defense in depth): the worker already
      // gated this, but the resource server must never trust that.
      await this.runs.recordToolAudit({
        runId: run.id,
        ownerSubject: run.ownerSubject,
        actor: WORKER_ACTOR,
        action: 'tool.invoke',
        capability: input.capabilityId,
        decision: 'deny',
        reason: capability ? 'missing_permission' : 'unknown_capability',
      });
      throw new ForbiddenError('The acting user is not entitled to this capability.');
    }

    const auth = this.authFromSnapshot(entitlement);
    const result = await this.executor.execute(input.capabilityId, input.input, auth);

    await this.runs.recordToolAudit({
      runId: run.id,
      ownerSubject: run.ownerSubject,
      actor: WORKER_ACTOR,
      action: 'tool.invoke',
      capability: input.capabilityId,
      decision: 'allow',
      reason: null,
    });
    return result;
  }

  /**
   * Persist the final assistant message to the business conversation (the only
   * plane allowed to touch the `nova` DB) and pin the response reference on the
   * run. The worker then marks the run completed.
   */
  async finalizeRun(input: FinalizeRunInput): Promise<FinalizeResult> {
    const { run } = await this.loadVerified(input.runId);
    if (!run.conversationId) {
      throw new NotFoundError('Run has no associated conversation.');
    }
    const message = await this.conversations.addMessage({
      conversationId: run.conversationId,
      role: MessageRole.ASSISTANT,
      text: input.text,
      isMCPApps: input.links.length > 0,
      MCPAppLink: input.links[0]?.href ?? null,
      MCPActive: input.links.length > 0 ? true : null,
      createdDate: new Date(),
    });
    const responseRef = `nova-msg://${run.conversationId}/${message.id}`;
    await this.runs.setResponseRef(run.id, responseRef);
    return { responseRef };
  }

  /**
   * Return the verified entitlement snapshot for a run (decision D2). The DB MCP
   * server and the agent call this to re-enforce authorization independently.
   * Fails closed on a tampered/expired snapshot via {@link loadVerified}; never
   * returns tokens, prompts, rows, or other PII.
   */
  async getEntitlement(runId: string): Promise<EntitlementView> {
    const { entitlement } = await this.loadVerified(runId);
    return {
      runId,
      ownerSubject: entitlement.ownerSubject,
      roles: [...entitlement.roles],
      permissions: [...entitlement.permissions],
      capabilityAllowlist: [...entitlement.capabilityAllowlist],
      snapshotHash: entitlement.snapshotHash,
      issuedAt: entitlement.issuedAt.toISOString(),
      expiresAt: entitlement.expiresAt.toISOString(),
    };
  }

  /** Load run + entitlement and fail closed on a tampered/expired snapshot. */
  private async loadVerified(
    runId: string,
  ): Promise<{ run: import('@nova/database').AgentRun; entitlement: AgentRunEntitlement }> {
    const found = await this.runs.findRunWithEntitlement(runId);
    if (!found) {
      throw new NotFoundError('Agent run not found.');
    }
    const { run, entitlement } = found;

    const recomputed = computeSnapshotHash({
      ownerSubject: entitlement.ownerSubject,
      roles: entitlement.roles,
      permissions: entitlement.permissions,
      capabilityAllowlist: entitlement.capabilityAllowlist,
      issuedAtEpochS: Math.floor(entitlement.issuedAt.getTime() / 1000),
      expiresAtEpochS: Math.floor(entitlement.expiresAt.getTime() / 1000),
    });
    if (recomputed !== entitlement.snapshotHash) {
      this.logger.error({ runId }, 'entitlement snapshot hash mismatch; failing closed');
      await this.runs.recordToolAudit({
        runId: run.id,
        ownerSubject: run.ownerSubject,
        actor: WORKER_ACTOR,
        action: 'snapshot.verify',
        capability: null,
        decision: 'deny',
        reason: 'snapshot_hash_mismatch',
      });
      throw new ForbiddenError('Entitlement snapshot failed integrity verification.');
    }
    if (entitlement.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenError('Entitlement snapshot has expired.');
    }
    return { run, entitlement };
  }

  /** Reconstruct a minimal AuthContext from the immutable snapshot. */
  private authFromSnapshot(entitlement: AgentRunEntitlement): AuthContext {
    return {
      subject: entitlement.ownerSubject,
      applicationUserId: entitlement.ownerUserId,
      issuer: '',
      audience: [],
      email: undefined,
      username: undefined,
      givenName: undefined,
      familyName: undefined,
      roles: getActiveRegistry().knownRoles(entitlement.roles),
      permissions: new Set<string>(entitlement.permissions),
      scopes: [],
    };
  }
}
