import { ActionComment, IssueAction, type IssueActionStatus } from '@nova/database';
import type { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface ActionListFilter extends PageRequest {
  readonly status?: IssueActionStatus;
  readonly assignedOwnerId?: string;
  readonly issueId?: string;
}

export interface ActionListResult {
  readonly items: IssueAction[];
  readonly total: number;
}

export interface UpdateActionData {
  readonly status?: IssueActionStatus;
  readonly description?: string;
  readonly assignedOwnerId?: string;
  readonly updatedById: string;
}

export interface CreateCommentData {
  readonly issueActionId: string;
  readonly userId: string;
  readonly comment: string;
  readonly datetime: Date;
}

export class ActionRepository {
  private readonly actions: Repository<IssueAction>;
  private readonly comments: Repository<ActionComment>;

  constructor(dataSource: DataSource) {
    this.actions = dataSource.getRepository(IssueAction);
    this.comments = dataSource.getRepository(ActionComment);
  }

  async findPaginated(filter: ActionListFilter): Promise<ActionListResult> {
    const where: FindOptionsWhere<IssueAction> = {};
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.assignedOwnerId) {
      where.assignedOwnerId = filter.assignedOwnerId;
    }
    if (filter.issueId) {
      where.issueId = filter.issueId;
    }

    const [items, total] = await this.actions.findAndCount({
      where,
      relations: {
        assignedOwner: true,
        updatedBy: true,
        comments: { user: true },
        dependencies: true,
      },
      order: { createdDate: 'DESC', id: 'DESC', comments: { datetime: 'ASC' } },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
    return { items, total };
  }

  async findById(id: string): Promise<IssueAction | null> {
    return this.actions.findOne({
      where: { id },
      relations: {
        assignedOwner: true,
        updatedBy: true,
        comments: { user: true },
        dependencies: true,
      },
      order: { comments: { datetime: 'ASC' } },
    });
  }

  async exists(id: string): Promise<boolean> {
    return this.actions.exists({ where: { id } });
  }

  async update(id: string, data: UpdateActionData): Promise<void> {
    const patch: Partial<IssueAction> = { updatedById: data.updatedById, updatedAI: false };
    if (data.status !== undefined) {
      patch.status = data.status;
    }
    if (data.description !== undefined) {
      patch.description = data.description;
    }
    if (data.assignedOwnerId !== undefined) {
      patch.assignedOwnerId = data.assignedOwnerId;
    }
    await this.actions.update({ id }, patch);
  }

  async addComment(data: CreateCommentData): Promise<ActionComment> {
    const comment = this.comments.create(data);
    const saved = await this.comments.save(comment);
    const reloaded = await this.comments.findOne({
      where: { id: saved.id },
      relations: { user: true },
    });
    return reloaded ?? saved;
  }
}
