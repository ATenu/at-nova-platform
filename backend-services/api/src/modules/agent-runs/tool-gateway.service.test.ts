import { ForbiddenError, permissionsForRoles, type Logger } from '@nova/shared';
import type { AgentRun, AgentRunEntitlement } from '@nova/database';
import { ToolGatewayService } from './tool-gateway.service';
import type { AgentRunRepository, RunWithEntitlement, ToolAuditInput } from './agent-run.repository';
import type { ConversationRepository } from '../chat/conversation.repository';
import type { CapabilityServices } from './capability-executor';
import { buildEntitlementSnapshot } from './entitlement-snapshot';

function silentLogger(): Logger {
  const noop = (): void => {};
  const logger = {
    child: (): Logger => logger,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  } as unknown as Logger;
  return logger;
}

/** Build a run + a valid (correctly-hashed) entitlement snapshot for a role set. */
function runWithEntitlement(roles: ('sales-user' | 'ops-compliance')[]): RunWithEntitlement {
  const snapshot = buildEntitlementSnapshot({
    ownerSubject: 'kc-1',
    ownerUserId: 'user-1',
    roles,
    permissions: permissionsForRoles(roles),
    ttlSeconds: 3600,
  });
  const entitlement = {
    id: 'ent-1',
    ownerSubject: snapshot.ownerSubject,
    ownerUserId: snapshot.ownerUserId,
    roles: [...snapshot.roles],
    permissions: [...snapshot.permissions],
    capabilityAllowlist: [...snapshot.capabilityAllowlist],
    snapshotHash: snapshot.snapshotHash,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
  } as AgentRunEntitlement;
  const run = {
    id: 'run-1',
    ownerSubject: 'kc-1',
    ownerUserId: 'user-1',
    conversationId: 'conv-1',
    entitlementSnapshotId: 'ent-1',
  } as AgentRun;
  return { run, entitlement };
}

interface Harness {
  service: ToolGatewayService;
  audits: ToolAuditInput[];
}

function harness(found: RunWithEntitlement | null): Harness {
  const audits: ToolAuditInput[] = [];
  const runs = {
    findRunWithEntitlement: async () => found,
    recordToolAudit: async (input: ToolAuditInput) => {
      audits.push(input);
    },
    setResponseRef: async () => undefined,
  } as unknown as AgentRunRepository;
  const conversations = {} as unknown as ConversationRepository;
  // Sales report would call these; the deny paths must short-circuit first.
  const services = {
    customers: { getCustomerById: async () => ({ fullName: 'Acme' }) },
    sales: { listSales: async () => ({ items: [], total: 0 }) },
    issues: {},
    actions: {},
    sops: {},
  } as unknown as CapabilityServices;
  const service = new ToolGatewayService(runs, conversations, services, silentLogger());
  return { service, audits };
}

describe('ToolGatewayService', () => {
  it('executes a capability the snapshot grants and audits allow', async () => {
    const { service, audits } = harness(runWithEntitlement(['sales-user']));
    const result = await service.executeCapability({
      runId: 'run-1',
      capabilityId: 'sales.report.customer',
      input: { customerId: '11111111-1111-1111-1111-111111111111' },
    });
    expect(result.capabilityId).toBe('sales.report.customer');
    expect(audits.at(-1)).toMatchObject({ decision: 'allow', capability: 'sales.report.customer' });
  });

  it('denies a capability the snapshot does not grant (default deny) and audits deny', async () => {
    // ops-compliance lacks write-sales, so sales.create must be denied.
    const { service, audits } = harness(runWithEntitlement(['ops-compliance']));
    await expect(
      service.executeCapability({ runId: 'run-1', capabilityId: 'sales.create', input: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(audits.at(-1)).toMatchObject({ decision: 'deny', capability: 'sales.create' });
  });

  it('fails closed when the entitlement snapshot hash is tampered', async () => {
    const found = runWithEntitlement(['sales-user']);
    (found.entitlement as { snapshotHash: string }).snapshotHash = 'sha256:tampered';
    const { service, audits } = harness(found);
    await expect(
      service.executeCapability({
        runId: 'run-1',
        capabilityId: 'sales.report.customer',
        input: { customerId: '11111111-1111-1111-1111-111111111111' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(audits.at(-1)).toMatchObject({ decision: 'deny', reason: 'snapshot_hash_mismatch' });
  });
});
