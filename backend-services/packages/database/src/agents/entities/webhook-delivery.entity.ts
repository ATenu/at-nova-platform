import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { WebhookDeliveryStatus } from '../agent-enums';
import { AgentRun } from './agent-run.entity';
import { AgentRunEvent } from './agent-run-event.entity';

/**
 * Transactional-outbox row for a single webhook delivery attempt stream
 * (section 12). The worker writes one row in the SAME transaction as the event
 * it describes; a separate dispatcher claims pending rows, signs + sends, and
 * records success/failure with exponential backoff into `next_attempt_at` until
 * the row reaches `succeeded` or `dead_letter`.
 */
@Entity({ name: 'webhook_deliveries' })
@Index('IDX_webhook_deliveries_run_id', ['runId'])
@Index('IDX_webhook_deliveries_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('UQ_webhook_deliveries_event_destination', ['eventId', 'destinationUrl'], { unique: true })
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'owner_subject', type: 'text' })
  ownerSubject!: string;

  @Column({ name: 'destination_url', type: 'text' })
  destinationUrl!: string;

  /** Reference to the auth config used to sign/authenticate this delivery. */
  @Column({ name: 'auth_config_id', type: 'uuid', nullable: true })
  authConfigId!: string | null;

  @Column({ name: 'status', type: 'text' })
  status!: WebhookDeliveryStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @ManyToOne(() => AgentRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: AgentRun;

  @ManyToOne(() => AgentRunEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event!: AgentRunEvent;
}
