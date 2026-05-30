import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { IssueAction } from './issue-action.entity';
import { User } from './user.entity';

@Entity({ name: 'action_comments' })
@Index('IDX_action_comments_issue_action_id', ['issueActionId'])
@Index('IDX_action_comments_user_id', ['userId'])
@Index('IDX_action_comments_datetime', ['datetime'])
export class ActionComment extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'issue_action_id', type: 'uuid' })
  issueActionId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'comment', type: 'text' })
  comment!: string;

  @Column({ name: 'datetime', type: 'timestamptz' })
  datetime!: Date;

  @ManyToOne(() => IssueAction, (action) => action.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'issue_action_id' })
  issueAction!: IssueAction;

  @ManyToOne(() => User, (user) => user.actionComments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
