import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit trail of every RBAC policy change made through the admin
 * surface (role/permission/grant/capability/route/view mutations). No secrets or
 * tokens are ever stored; `details` holds only the changed policy identifiers.
 */
@Entity({ name: 'rbac_audit_log' })
export class RbacAuditLog {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Keycloak subject (sub) of the acting admin. */
  @Index('IDX_rbac_audit_log_actor_subject')
  @Column({ name: 'actor_subject', type: 'varchar', length: 255 })
  actorSubject!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /** e.g. 'role.create', 'role-permission.grant', 'capability.update'. */
  @Column({ name: 'action', type: 'varchar', length: 80 })
  action!: string;

  /** e.g. 'role' | 'permission' | 'capability' | 'route' | 'view'. */
  @Column({ name: 'target_type', type: 'varchar', length: 40 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 200 })
  targetId!: string;

  @Column({ name: 'details', type: 'jsonb', nullable: true })
  details!: unknown;

  @Index('IDX_rbac_audit_log_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
