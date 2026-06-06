import type { A2aAgentRegistration } from '@nova/database';
import { skillsFromCard, toAgentRegistrationDto } from './admin-agent.dto';

function fakeRow(overrides: Partial<A2aAgentRegistration> = {}): A2aAgentRegistration {
  return {
    name: 'at-usecase-x',
    baseUrl: 'https://usecase-x.internal:8443',
    audience: 'nova-agent-usecase-x',
    card: {
      name: 'at-usecase-x',
      version: '1.2.0',
      skills: [
        { id: 'data.analyse.read', name: 'Analyse', description: 'Read views', tags: ['count'] },
      ],
    },
    skillIds: ['data.analyse.read'],
    source: 'admin',
    status: 'onboarded',
    enabled: true,
    displayName: 'Use-case X',
    description: 'Does X',
    version: '1.2.0',
    tags: ['finance'],
    onboardedBy: 'kc-admin',
    onboardedAt: new Date('2026-06-01T00:00:00.000Z'),
    lastCardFetchAt: new Date('2026-06-01T00:00:00.000Z'),
    consecutiveFailures: 0,
    lastError: null,
    registeredAt: new Date('2026-06-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-06-01T00:05:00.000Z'),
    ...overrides,
  } as A2aAgentRegistration;
}

describe('skillsFromCard (defensive parsing)', () => {
  it('parses typed skills and never throws on malformed input', () => {
    expect(skillsFromCard(undefined)).toEqual([]);
    expect(skillsFromCard({ skills: 'nope' })).toEqual([]);
    expect(skillsFromCard({ skills: [{ no_id: true }, { id: '' }] })).toEqual([]);
  });

  it('defaults missing name/description/tags and drops non-string tags', () => {
    const skills = skillsFromCard({ skills: [{ id: 'x', tags: ['a', 5, 'b'] }] });
    expect(skills).toEqual([{ id: 'x', name: 'x', description: '', tags: ['a', 'b'] }]);
  });
});

describe('toAgentRegistrationDto', () => {
  it('maps only known typed fields and ISO timestamps', () => {
    const dto = toAgentRegistrationDto(fakeRow());
    expect(dto).toMatchObject({
      name: 'at-usecase-x',
      source: 'admin',
      status: 'onboarded',
      enabled: true,
      version: '1.2.0',
      tags: ['finance'],
      onboardedBy: 'kc-admin',
      lastError: null,
    });
    expect(dto.skills).toEqual([
      { id: 'data.analyse.read', name: 'Analyse', description: 'Read views', tags: ['count'] },
    ]);
    expect(dto.registeredAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('never echoes arbitrary/secret card properties', () => {
    const dto = toAgentRegistrationDto(
      fakeRow({ card: { secret: 'kv://leak', token: 'abc', skills: [{ id: 'data.analyse.read' }] } }),
    );
    expect(JSON.stringify(dto)).not.toContain('kv://leak');
    expect(JSON.stringify(dto)).not.toContain('abc');
  });

  it('handles a malformed card without throwing (empty skills)', () => {
    const dto = toAgentRegistrationDto(fakeRow({ card: { skills: 'broken' } as never }));
    expect(dto.skills).toEqual([]);
  });
});
