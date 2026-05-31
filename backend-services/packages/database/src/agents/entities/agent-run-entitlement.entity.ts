import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Immutable authorization snapshot captured by the Node control plane at run
 * submission. The execution plane authorizes from this integrity-checked
 * snapshot (never from fields trusted off the wire), and `expires_at` bounds
 * how long an async run may keep acting for the user, independent of the user's
 * short-lived access token.
 *
 * Rows are write-once: never updated after insert.
 */
@Entity({ name: 'agent_run_entitlements' })
@Index('IDX_agent_run_entitlements_owner_subject', ['ownerSubject'])
export class AgentRunEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_subject', type: 'text' })
  ownerSubject!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  /** Realm roles at submission time. */
  @Column({ name: 'roles', type: 'jsonb' })
  roles!: string[];

  /** Derived permission set (@nova/shared). */
  @Column({ name: 'permissions', type: 'jsonb' })
  permissions!: string[];

  /** Capability ids resolved from the permission set via the catalog. */
  @Column({ name: 'capability_allowlist', type: 'jsonb' })
  capabilityAllowlist!: string[];

  /** sha256 over the canonical payload; verified before every hop. */
  @Column({ name: 'snapshot_hash', type: 'text' })
  snapshotHash!: string;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
