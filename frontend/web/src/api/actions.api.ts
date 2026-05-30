import { http } from './httpClient';
import type { ActionCommentDto, IssueActionDto, IssueActionStatus, PaginatedResult } from './types';

export interface ListActionsParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly status?: IssueActionStatus | undefined;
  readonly assignedOwnerId?: string | undefined;
  readonly issueId?: string | undefined;
}

export interface UpdateActionRequest {
  readonly status?: IssueActionStatus;
  readonly description?: string;
  readonly assignedOwnerId?: string;
}

export interface AddCommentRequest {
  readonly comment: string;
  readonly datetime: string;
}

/** Backed by `GET /actions`, `PATCH /actions/:id`, `POST /actions/:id/comments`. */
export function listActions(
  params: ListActionsParams = {},
): Promise<PaginatedResult<IssueActionDto>> {
  return http.get<PaginatedResult<IssueActionDto>>('/actions', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 50,
      ...(params.status ? { status: params.status } : {}),
      ...(params.assignedOwnerId ? { assignedOwnerId: params.assignedOwnerId } : {}),
      ...(params.issueId ? { issueId: params.issueId } : {}),
    },
  });
}

export function updateAction(id: string, body: UpdateActionRequest): Promise<IssueActionDto> {
  return http.patch<IssueActionDto>(`/actions/${id}`, body);
}

export function addActionComment(id: string, body: AddCommentRequest): Promise<ActionCommentDto> {
  return http.post<ActionCommentDto>(`/actions/${id}/comments`, body);
}
