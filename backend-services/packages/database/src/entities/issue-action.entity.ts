import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { IssueActionStatus, PG_ENUM_TYPES } from '../enums';
import { CustomerIssue } from './customer-issue.entity';
import { User } from './user.entity';
import { ActionComment } from './action-comment.entity';
import { IssueActionDependency } from './issue-action-dependency.entity';

/** A unit of work that advances a customer issue toward resolution. */
@Entity({ name: 'issue_actions' })
@Index('IDX_issue_actions_issue_id', ['issueId'])
@Index('IDX_issue_actions_status', ['status'])
@Index('IDX_issue_actions_assigned_owner_id', ['assignedOwnerId'])
@Index('IDX_issue_actions_created_date', ['createdDate'])
export class IssueAction extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'issue_id', type: 'uuid' })
  issueId!: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: IssueActionStatus,
    enumName: PG_ENUM_TYPES.issueActionStatus,
  })
  status!: IssueActionStatus;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @Column({ name: 'updated_ai', type: 'boolean', default: false })
  updatedAI!: boolean;

  @Column({ name: 'created_date', type: 'timestamptz' })
  createdDate!: Date;

  @Column({ name: 'assigned_owner_id', type: 'uuid' })
  assignedOwnerId!: string;

  @ManyToOne(() => CustomerIssue, (issue) => issue.issueActions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'issue_id' })
  issue!: CustomerIssue;

  @ManyToOne(() => User, (user) => user.assignedIssueActions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assigned_owner_id' })
  assignedOwner!: User;

  @ManyToOne(() => User, (user) => user.updatedIssueActions, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: User | null;

  @OneToMany(() => ActionComment, (comment) => comment.issueAction)
  comments!: ActionComment[];

  @OneToMany(() => IssueActionDependency, (dependency) => dependency.action)
  dependencies!: IssueActionDependency[];

  @OneToMany(() => IssueActionDependency, (dependency) => dependency.dependsOnAction)
  dependents!: IssueActionDependency[];
}
