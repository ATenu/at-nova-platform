import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { UserRole } from './user-role.entity';
import { Conversation } from './conversation.entity';
import { IssueAction } from './issue-action.entity';
import { ActionComment } from './action-comment.entity';
import { SopDetail } from './sop-detail.entity';

/** Application user profile. Authentication is handled externally; no credentials are stored. */
@Entity({ name: 'users' })
export class User extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_users_email', { unique: true })
  @Column({ name: 'email', type: 'varchar', length: 320 })
  email!: string;

  /** Keycloak user id once provisioned/reconciled; null until linked. */
  @Column({ name: 'keycloak_id', type: 'uuid', nullable: true })
  keycloakId!: string | null;

  /** Whether the account is active (mirrors Keycloak `enabled`). */
  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'first_name', type: 'varchar', length: 255 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 255 })
  lastName!: string;

  @Column({ name: 'middle_name', type: 'varchar', length: 255, nullable: true })
  middleName!: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles!: UserRole[];

  @OneToMany(() => Conversation, (conversation) => conversation.user)
  conversations!: Conversation[];

  @OneToMany(() => IssueAction, (action) => action.assignedOwner)
  assignedIssueActions!: IssueAction[];

  @OneToMany(() => IssueAction, (action) => action.updatedBy)
  updatedIssueActions!: IssueAction[];

  @OneToMany(() => ActionComment, (comment) => comment.user)
  actionComments!: ActionComment[];

  @OneToMany(() => SopDetail, (detail) => detail.createdBy)
  createdSopDetails!: SopDetail[];
}
