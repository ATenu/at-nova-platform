import { http } from './httpClient';
import type { CustomerIssueDto, CustomerIssueStatus, PaginatedResult } from './types';

export interface ListIssuesParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly status?: CustomerIssueStatus | undefined;
  readonly customerId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface CreateIssueRequest {
  readonly salesId: string;
  readonly description: string;
  readonly dateRaised: string;
  readonly status: CustomerIssueStatus;
}

export interface UpdateIssueRequest {
  readonly description?: string;
  readonly status?: CustomerIssueStatus;
  readonly dateLastUpdate?: string;
}

/** Backed by `GET/POST /issues`, `GET/PATCH /issues/:id`. Mock mode mirrors the API. */
export function listIssues(
  params: ListIssuesParams = {},
): Promise<PaginatedResult<CustomerIssueDto>> {
  return http.get<PaginatedResult<CustomerIssueDto>>('/issues', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.status ? { status: params.status } : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
  });
}

export function getIssue(id: string): Promise<CustomerIssueDto> {
  return http.get<CustomerIssueDto>(`/issues/${id}`);
}

export function createIssue(body: CreateIssueRequest): Promise<CustomerIssueDto> {
  return http.post<CustomerIssueDto>('/issues', body);
}

export function updateIssue(id: string, body: UpdateIssueRequest): Promise<CustomerIssueDto> {
  return http.patch<CustomerIssueDto>(`/issues/${id}`, body);
}
