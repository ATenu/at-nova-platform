import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AgentEventType, AgentEventVisibility, WebhookAuthType } from '../agent-enums';

/**
 * Per-owner webhook authentication configuration (section 13). Holds only
 * *references* to secrets (`*_secret_ref`, e.g. `kv://owner/<sub>/webhook/hmac/v3`),
 * never the secret material itself, so a DB compromise cannot leak signing keys.
 */
@Entity({ name: 'webhook_auth_configs' })
@Index('IDX_webhook_auth_configs_owner_subject', ['ownerSubject'])
export class WebhookAuthConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_subject', type: 'text' })
  ownerSubject!: string;

  @Column({ name: 'auth_type', type: 'text' })
  authType!: WebhookAuthType;

  @Column({ name: 'token_secret_ref', type: 'text', nullable: true })
  tokenSecretRef!: string | null;

  @Column({ name: 'hmac_secret_ref', type: 'text', nullable: true })
  hmacSecretRef!: string | null;

  @Column({ name: 'jwks_url', type: 'text', nullable: true })
  jwksUrl!: string | null;

  @Column({ name: 'audience', type: 'text', nullable: true })
  audience!: string | null;

  @Column({ name: 'issuer', type: 'text', nullable: true })
  issuer!: string | null;

  @Column({ name: 'destination_url', type: 'text' })
  destinationUrl!: string;

  /**
   * Which event visibilities this owner's webhook receives (default = all three).
   * The browser SSE stream is always `user`-only and unaffected by this field;
   * only the server-to-server audit webhook may additionally carry
   * `internal`/`security`. Lets an owner who does not need the full firehose
   * narrow it (opt-out), without ever widening the browser channel.
   */
  @Column({
    name: 'visibility_scope',
    type: 'jsonb',
    default: () => `'["user","internal","security"]'::jsonb`,
  })
  visibilityScope!: AgentEventVisibility[];

  /**
   * Optional allowlist of event types to deliver. `null` = all types (firehose).
   */
  @Column({ name: 'event_type_allowlist', type: 'jsonb', nullable: true })
  eventTypeAllowlist!: AgentEventType[] | null;

  /**
   * Entitlement-gated opt-in for literal SQL / raw row bodies in webhook
   * payloads. Default OFF: SQL stays hashed (`sqlHash`) and reads are summarized
   * by `rowCount`. The owner must hold the data-layer entitlement and accept PII
   * handling before this is enabled.
   */
  @Column({ name: 'include_raw_payloads', type: 'boolean', default: false })
  includeRawPayloads!: boolean;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt!: Date | null;
}
