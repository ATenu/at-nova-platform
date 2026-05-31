import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { WebhookAuthType } from '../agent-enums';

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

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt!: Date | null;
}
