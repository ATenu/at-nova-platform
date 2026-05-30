import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { IssueAction } from './issue-action.entity';

/**
 * Directed dependency between two issue actions: `action` depends on
 * `dependsOnAction`. Modelled as a proper join table rather than an
 * unstructured array (composite primary key).
 */
@Entity({ name: 'issue_action_dependencies' })
export class IssueActionDependency {
  @PrimaryColumn({ name: 'action_id', type: 'uuid' })
  actionId!: string;

  @PrimaryColumn({ name: 'depends_on_action_id', type: 'uuid' })
  dependsOnActionId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => IssueAction, (action) => action.dependencies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'action_id' })
  action!: IssueAction;

  @ManyToOne(() => IssueAction, (action) => action.dependents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'depends_on_action_id' })
  dependsOnAction!: IssueAction;
}
