import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Discovery source: agent self-registration vs operator (admin) onboarding. */
export type A2aAgentSource = 'self' | 'admin';

/** Lifecycle status surfaced in the admin registry view. */
export type A2aAgentStatus = 'onboarded' | 'unreachable' | 'disabled' | 'failed';

/**
 * Read/metadata-mutation view of the A2A agent registry from the Node control
 * plane. The orchestrator owns the native A2A card fetch + skill derivation +
 * routing semantics; Node reads this table for the admin registry surface and
 * performs pure-metadata mutations (enable/disable/remove of admin-source rows).
 *
 * The stored `card` is trusted for discovery only — Node never authorizes from
 * it and the DTO mapper extracts only known, typed fields. Node never
 * `synchronize`s this table (the schema is owned by the agents-DB migrations).
 */
@Entity({ name: 'a2a_agent_registrations' })
@Index('IDX_a2a_agent_registrations_source', ['source'])
export class A2aAgentRegistration {
  @PrimaryColumn({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ name: 'audience', type: 'text' })
  audience!: string;

  /** Raw Agent Card (discovery data only; never an authorization source). */
  @Column({ name: 'card', type: 'jsonb' })
  card!: Record<string, unknown>;

  /** Catalog-derivable skill ids advertised by the card. */
  @Column({ name: 'skill_ids', type: 'jsonb' })
  skillIds!: string[];

  @Column({ name: 'source', type: 'text', default: 'self' })
  source!: A2aAgentSource;

  @Column({ name: 'status', type: 'text', default: 'onboarded' })
  status!: A2aAgentStatus;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'version', type: 'text', nullable: true })
  version!: string | null;

  @Column({ name: 'tags', type: 'jsonb', default: () => `'[]'::jsonb` })
  tags!: string[];

  /** Keycloak subject of the admin who onboarded this row (admin source only). */
  @Column({ name: 'onboarded_by', type: 'text', nullable: true })
  onboardedBy!: string | null;

  @Column({ name: 'onboarded_at', type: 'timestamptz', nullable: true })
  onboardedAt!: Date | null;

  @Column({ name: 'last_card_fetch_at', type: 'timestamptz', nullable: true })
  lastCardFetchAt!: Date | null;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures!: number;

  /** Sanitised, coarse failure reason (never raw upstream bodies). */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'registered_at', type: 'timestamptz' })
  registeredAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;
}
