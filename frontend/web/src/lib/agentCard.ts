/** Well-known A2A Agent Card path (native discovery). */
export const AGENT_CARD_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/**
 * Docker Compose service hostnames that are reachable only on the internal
 * network. Map them to localhost so operators can open the card from the host
 * browser during local development.
 */
const LOCAL_DEV_HOST_OVERRIDES: Readonly<Record<string, string>> = {
  'at-sql-analyser': 'localhost',
  'nova-agent-sql-analyst': 'localhost',
};

/**
 * Build a browser-openable URL for an agent's native A2A discovery card.
 * Internal Docker DNS names are rewritten to localhost; production URLs are
 * left unchanged.
 */
export function resolveAgentCardUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return AGENT_CARD_WELL_KNOWN_PATH;
  }

  try {
    const url = new URL(trimmed);
    const override = LOCAL_DEV_HOST_OVERRIDES[url.hostname];
    if (override) {
      url.hostname = override;
    }
    url.pathname = AGENT_CARD_WELL_KNOWN_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `${trimmed}${AGENT_CARD_WELL_KNOWN_PATH}`;
  }
}
