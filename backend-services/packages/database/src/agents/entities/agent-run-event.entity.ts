import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { AgentEventType, AgentEventVisibility } from '../agent-enums';
import { AgentRun } from './agent-run.entity';

/**
 * Append-only progress/security event for a run. Written transactionally with
 * the state change it describes (event outbox). `visibility` controls exposure:
 * only `user`-visibility events are ever streamed to the end user;
 * `internal`/`security` events (e.g. `authz.denied`) never leave the backend.
 */
@Entity({ name: 'agent_run_events' })
@Index('UQ_agent_run_events_run_sequence', ['runId', 'sequence'], { unique: true })
@Index('IDX_agent_run_events_owner_subject', ['ownerSubject'])
export class AgentRunEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'owner_subject', type: 'text' })
  ownerSubject!: string;

  /** Monotonic per-run sequence (1-based) for ordered, resumable streaming. */
  @Column({ name: 'sequence', type: 'bigint' })
  sequence!: string;

  @Column({ name: 'type', type: 'text' })
  type!: AgentEventType;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'visibility', type: 'text' })
  visibility!: AgentEventVisibility;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => AgentRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: AgentRun;
}
