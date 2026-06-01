import { authorizeCapability, isEntitled } from './authorize';
import type { VerifiedSnapshot } from './snapshot-client';

function snapshot(overrides: Partial<VerifiedSnapshot> = {}): VerifiedSnapshot {
  return {
    runId: 'run-1',
    ownerSubject: 'sub-1',
    roles: ['support-operations-user'],
    permissions: ['create-agent-run', 'read-sales'],
    capabilityAllowlist: ['data.schema.describe', 'data.query.select'],
    expiresAtEpochS: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

describe('authorizeCapability', () => {
  it('allows an entitled capability present in the allowlist', () => {
    expect(() => authorizeCapability(snapshot(), 'data.query.select')).not.toThrow();
  });

  it('denies an unknown capability', () => {
    expect(() => authorizeCapability(snapshot(), 'not.a.capability')).toThrow();
  });

  it('denies when the required permission is missing', () => {
    expect(() =>
      authorizeCapability(snapshot({ permissions: [], capabilityAllowlist: [] }), 'data.query.select'),
    ).toThrow();
  });

  it('denies when the capability is not in the snapshot allowlist (defense in depth)', () => {
    expect(() =>
      authorizeCapability(snapshot({ capabilityAllowlist: ['data.schema.describe'] }), 'data.query.select'),
    ).toThrow();
  });
});

describe('isEntitled', () => {
  it('is true only when permission AND allowlist agree', () => {
    expect(isEntitled(snapshot(), 'data.query.select')).toBe(true);
    expect(isEntitled(snapshot({ capabilityAllowlist: [] }), 'data.query.select')).toBe(false);
    expect(isEntitled(snapshot({ permissions: [] }), 'data.query.select')).toBe(false);
    expect(isEntitled(snapshot(), 'unknown')).toBe(false);
  });
});
