import { IssueActionStatus } from '@nova/database';
import { NotFoundError, ValidationError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from '../users/current-user';
import type { UserRepository } from '../users/user.repository';
import type { IssueRepository } from '../issues/issue.repository';
import {
  toActionCommentDto,
  toIssueActionDto,
  type ActionCommentDto,
  type IssueActionDto,
} from './action.dto';
import type { ActionListFilter, ActionRepository } from './action.repository';

export interface CreateActionInput {
  readonly issueId: string;
  readonly title: string;
  readonly description: string;
  readonly assignedOwnerId?: string | undefined;
  readonly status?: IssueActionStatus | undefined;
}

export interface UpdateActionInput {
  readonly status?: IssueActionStatus | undefined;
  readonly description?: string | undefined;
  readonly assignedOwnerId?: string | undefined;
}

export interface AddCommentInput {
  readonly comment: string;
  readonly datetime: string;
}

export class ActionService {
  constructor(
    private readonly actions: ActionRepository,
    private readonly users: UserRepository,
    private readonly issues: IssueRepository,
  ) {}

  async listActions(filter: ActionListFilter): Promise<PaginatedResult<IssueActionDto>> {
    const { items, total } = await this.actions.findPaginated(filter);
    return buildPaginatedResult(items.map(toIssueActionDto), total, filter);
  }

  async getActionById(id: string): Promise<IssueActionDto> {
    const action = await this.actions.findById(id);
    if (!action) {
      throw new NotFoundError('Issue action not found.');
    }
    return toIssueActionDto(action);
  }

  async createAction(input: CreateActionInput, auth: AuthContext): Promise<IssueActionDto> {
    if (!(await this.issues.findById(input.issueId))) {
      throw new ValidationError('The referenced issue does not exist.');
    }
    const { user } = await resolveCurrentUser(this.users, auth);
    const assignedOwnerId = input.assignedOwnerId ?? user.id;
    if (!(await this.users.findById(assignedOwnerId))) {
      throw new ValidationError('The assigned owner does not exist.');
    }
    const now = new Date();
    const id = await this.actions.create({
      issueId: input.issueId,
      title: input.title,
      description: input.description,
      status: input.status ?? IssueActionStatus.PENDING,
      assignedOwnerId,
      createdDate: now,
      updatedById: user.id,
    });
    return this.getActionById(id);
  }

  async updateAction(
    id: string,
    input: UpdateActionInput,
    auth: AuthContext,
  ): Promise<IssueActionDto> {
    if (!(await this.actions.exists(id))) {
      throw new NotFoundError('Issue action not found.');
    }
    if (input.assignedOwnerId !== undefined && !(await this.users.findById(input.assignedOwnerId))) {
      throw new ValidationError('The assigned owner does not exist.');
    }
    const { user } = await resolveCurrentUser(this.users, auth);
    await this.actions.update(id, {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.assignedOwnerId !== undefined ? { assignedOwnerId: input.assignedOwnerId } : {}),
      updatedById: user.id,
    });
    return this.getActionById(id);
  }

  async addComment(
    actionId: string,
    input: AddCommentInput,
    auth: AuthContext,
  ): Promise<ActionCommentDto> {
    if (!(await this.actions.exists(actionId))) {
      throw new NotFoundError('Issue action not found.');
    }
    const { user } = await resolveCurrentUser(this.users, auth);
    const comment = await this.actions.addComment({
      issueActionId: actionId,
      userId: user.id,
      comment: input.comment,
      datetime: new Date(input.datetime),
    });
    return toActionCommentDto(comment);
  }
}
