import type { ActionComment, IssueAction, IssueActionDependency } from '@nova/database';
import { toUserSummaryDto, type UserSummaryDto } from '../users/user.dto';

export interface ActionCommentDto {
  readonly id: string;
  readonly issueActionId: string;
  readonly userId: string;
  readonly user?: UserSummaryDto | undefined;
  readonly comment: string;
  readonly datetime: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueActionDependencyDto {
  readonly actionId: string;
  readonly dependsOnActionId: string;
}

export interface IssueActionDto {
  readonly id: string;
  readonly issueId: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly updatedById: string | null;
  readonly updatedAI: boolean;
  readonly createdDate: string;
  readonly assignedOwnerId: string;
  readonly assignedOwner?: UserSummaryDto | undefined;
  readonly updatedBy?: UserSummaryDto | null | undefined;
  readonly comments?: readonly ActionCommentDto[] | undefined;
  readonly dependencies?: readonly IssueActionDependencyDto[] | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toActionCommentDto(comment: ActionComment): ActionCommentDto {
  return {
    id: comment.id,
    issueActionId: comment.issueActionId,
    userId: comment.userId,
    user: comment.user ? toUserSummaryDto(comment.user) : undefined,
    comment: comment.comment,
    datetime: comment.datetime.toISOString(),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export function toIssueActionDependencyDto(
  dependency: IssueActionDependency,
): IssueActionDependencyDto {
  return {
    actionId: dependency.actionId,
    dependsOnActionId: dependency.dependsOnActionId,
  };
}

export function toIssueActionDto(action: IssueAction): IssueActionDto {
  return {
    id: action.id,
    issueId: action.issueId,
    title: action.title,
    description: action.description,
    status: action.status,
    updatedById: action.updatedById,
    updatedAI: action.updatedAI,
    createdDate: action.createdDate.toISOString(),
    assignedOwnerId: action.assignedOwnerId,
    assignedOwner: action.assignedOwner ? toUserSummaryDto(action.assignedOwner) : undefined,
    updatedBy:
      action.updatedBy === undefined ? undefined : action.updatedBy
        ? toUserSummaryDto(action.updatedBy)
        : null,
    comments: action.comments ? action.comments.map(toActionCommentDto) : undefined,
    dependencies: action.dependencies
      ? action.dependencies.map(toIssueActionDependencyDto)
      : undefined,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };
}
