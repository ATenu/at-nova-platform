import { computeSnapshotHash, type ServiceTokenClient } from '@nova/shared';
import { SnapshotClient } from './snapshot-client';

const tokens = {
  getToken: jest.fn(async () => 'service-token'),
  invalidate: jest.fn(),
} as unknown as ServiceTokenClient;

function validBody(overrides: Record<string, unknown> = {}) {
  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date(Date.now() + 600_000);
  const base = {
    runId: 'run-1',
    ownerSubject: 'sub-1',
    roles: ['support-operations-user'],
    permissions: ['create-agent-run', 'read-sales'],
    capabilityAllowlist: ['data.query.select'],
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const merged = { ...base, ...overrides };
  const snapshotHash = computeSnapshotHash({
    ownerSubject: merged.ownerSubject as string,
    roles: merged.roles as string[],
    permissions: merged.permissions as string[],
    capabilityAllowlist: merged.capabilityAllowlist as string[],
    issuedAtEpochS: Math.floor(Date.parse(merged.issuedAt as string) / 1000),
    expiresAtEpochS: Math.floor(Date.parse(merged.expiresAt as string) / 1000),
  });
  return { ...merged, snapshotHash };
}

function mockFetch(status: number, body: unknown): void {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const client = new SnapshotClient(tokens, { baseUrl: 'http://nova-api:8000', audienceScope: 'nova-mcp-data' });

describe('SnapshotClient.fetchVerified', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns a verified snapshot when the hash matches and it is unexpired', async () => {
    mockFetch(200, validBody());
    const result = await client.fetchVerified('run-1');
    expect(result.ownerSubject).toBe('sub-1');
    expect(result.permissions).toContain('read-sales');
  });

  it('fails closed when the snapshot hash does not match (tampered fields)', async () => {
    const tampered = { ...validBody(), permissions: ['read-sales', 'write-sales'] };
    mockFetch(200, tampered);
    await expect(client.fetchVerified('run-1')).rejects.toThrow();
  });

  it('fails closed when the snapshot has expired', async () => {
    mockFetch(200, validBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(client.fetchVerified('run-1')).rejects.toThrow();
  });

  it('rejects on a non-OK control-plane response', async () => {
    mockFetch(404, {});
    await expect(client.fetchVerified('missing')).rejects.toThrow();
  });
});
