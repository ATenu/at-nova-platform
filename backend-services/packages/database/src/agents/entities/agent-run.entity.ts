import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from '../../entities/base.entity';
import type { AgentRunStatus } from '../agent-enums';
import { AgentRunEntitlement } from './agent-run-entitlement.entity';

/**
 * A long-running, asynchronous agent orchestration request. Owned by the
 * Keycloak subject (`owner_subject`) + the Nova application user
 * (`owner_user_id`). `prompt_ref`/`response_ref` reference encrypted object
 * storage rather than storing prompts/outputs inline. No user token, secret, or
 * PII is ever stored on this row.
 */
@Entity({ name: 'agent_runs' })
@Index('IDX_agent_runs_owner_subject', ['ownerSubject'])
@Index('IDX_agent_runs_status', ['status'])
@Index('UQ_agent_runs_owner_idempotency', ['ownerSubject', 'idempotencyKey'], { unique: true })
export class AgentRun extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_subject', type: 'text' })
  ownerSubject!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'org_id', type: 'uuid', default: '00000000-0000-0000-0000-000000000000' })
  orgId!: string;

  /** Logical, cross-database link to nova `conversations.id` (no FK). */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'status', type: 'text' })
  status!: AgentRunStatus;

  /** Reference to encrypted object storage; never the prompt itself. */
  @Column({ name: 'prompt_ref', type: 'text' })
  promptRef!: string;

  @Column({ name: 'response_ref', type: 'text', nullable: true })
  responseRef!: string | null;

  @Column({ name: 'callback_auth_config_id', type: 'uuid', nullable: true })
  callbackAuthConfigId!: string | null;

  @Column({ name: 'entitlement_snapshot_id', type: 'uuid' })
  entitlementSnapshotId!: string;

  @Column({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @Column({ name: 'cancel_requested', type: 'boolean', default: false })
  cancelRequested!: boolean;

  @Column({ name: 'last_heartbeat_at', type: 'timestamptz', nullable: true })
  lastHeartbeatAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @ManyToOne(() => AgentRunEntitlement, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entitlement_snapshot_id' })
  entitlement!: AgentRunEntitlement;
}
