import {
  agentNameParamsSchema,
  onboardAgentBodySchema,
  setAgentEnabledBodySchema,
} from './admin-agent.schema';

describe('onboardAgentBodySchema', () => {
  const valid = { hostUrl: 'https://agent.internal:8443', audience: 'nova-agent-x' };

  it('accepts a minimal valid payload', () => {
    expect(onboardAgentBodySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts optional metadata', () => {
    const result = onboardAgentBodySchema.safeParse({
      ...valid,
      name: 'at-usecase-x',
      displayName: 'Use-case X',
      description: 'desc',
      tags: ['finance', 'reporting'],
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(onboardAgentBodySchema.safeParse({ ...valid, hostUrl: 'ftp://agent/x' }).success).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(onboardAgentBodySchema.safeParse({ ...valid, hostUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects a missing audience', () => {
    expect(onboardAgentBodySchema.safeParse({ hostUrl: valid.hostUrl }).success).toBe(false);
  });

  it('rejects a bad name shape', () => {
    expect(onboardAgentBodySchema.safeParse({ ...valid, name: 'Bad_Name' }).success).toBe(false);
  });

  it('rejects oversized tag lists', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(onboardAgentBodySchema.safeParse({ ...valid, tags }).success).toBe(false);
  });
});

describe('setAgentEnabledBodySchema', () => {
  it('requires a boolean enabled', () => {
    expect(setAgentEnabledBodySchema.safeParse({ enabled: true }).success).toBe(true);
    expect(setAgentEnabledBodySchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});

describe('agentNameParamsSchema', () => {
  it('accepts DNS-ish names and rejects junk', () => {
    expect(agentNameParamsSchema.safeParse({ name: 'at-usecase-x' }).success).toBe(true);
    expect(agentNameParamsSchema.safeParse({ name: 'X' }).success).toBe(false);
  });
});
