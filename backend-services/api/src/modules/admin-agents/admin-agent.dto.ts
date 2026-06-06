import type { A2aAgentRegistration, A2aAgentSource, A2aAgentStatus } from '@nova/database';

/** Advertised skill metadata (menu text only) parsed defensively from the card. */
export interface AgentSkillDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface AgentRegistrationDto {
  readonly name: string;
  readonly displayName: string | null;
  readonly description: string | null;
  readonly baseUrl: string;
  readonly audience: string;
  readonly source: A2aAgentSource;
  readonly status: A2aAgentStatus;
  readonly enabled: boolean;
  readonly version: string | null;
  readonly tags: readonly string[];
  readonly skills: readonly AgentSkillDto[];
  readonly registeredAt: string;
  readonly lastSeenAt: string;
  readonly onboardedBy: string | null;
  readonly onboardedAt: string | null;
  readonly lastCardFetchAt: string | null;
  /** Sanitised, coarse failure reason (never raw upstream bodies). */
  readonly lastError: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract advertised skills from a stored Agent Card. Defensive (typed only):
 * a malformed `card.skills` yields `[]` and never throws, and only known string
 * fields are read — arbitrary card properties are never echoed back.
 */
export function skillsFromCard(card: unknown): AgentSkillDto[] {
  if (!isRecord(card) || !Array.isArray(card.skills)) {
    return [];
  }
  const skills: AgentSkillDto[] = [];
  for (const raw of card.skills) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    const name = typeof raw.name === 'string' ? raw.name : id;
    const description = typeof raw.description === 'string' ? raw.description : '';
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    skills.push({ id, name, description, tags });
  }
  return skills;
}

function tagsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

/** Map a registry row to its sanitised DTO. Never returns the raw entity/card. */
export function toAgentRegistrationDto(row: A2aAgentRegistration): AgentRegistrationDto {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    baseUrl: row.baseUrl,
    audience: row.audience,
    source: row.source,
    status: row.status,
    enabled: row.enabled,
    version: row.version,
    tags: tagsOf(row.tags),
    skills: skillsFromCard(row.card),
    registeredAt: row.registeredAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    onboardedBy: row.onboardedBy,
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
    lastCardFetchAt: row.lastCardFetchAt ? row.lastCardFetchAt.toISOString() : null,
    lastError: row.lastError,
  };
}
