import { describe, expect, it } from 'vitest';
import { AGENT_CARD_WELL_KNOWN_PATH, resolveAgentCardUrl } from './agentCard';

describe('resolveAgentCardUrl', () => {
  it('maps Docker internal hostnames to localhost for local dev', () => {
    expect(resolveAgentCardUrl('http://at-sql-analyser:8003')).toBe(
      `http://localhost:8003${AGENT_CARD_WELL_KNOWN_PATH}`,
    );
  });

  it('preserves production-style hostnames', () => {
    expect(resolveAgentCardUrl('https://agents.example.com/sql')).toBe(
      `https://agents.example.com${AGENT_CARD_WELL_KNOWN_PATH}`,
    );
  });

  it('strips trailing slashes from the base URL', () => {
    expect(resolveAgentCardUrl('http://at-sql-analyser:8003/')).toBe(
      `http://localhost:8003${AGENT_CARD_WELL_KNOWN_PATH}`,
    );
  });

  it('falls back when the base URL is not parseable', () => {
    expect(resolveAgentCardUrl('not-a-url')).toBe(`not-a-url${AGENT_CARD_WELL_KNOWN_PATH}`);
  });
});
