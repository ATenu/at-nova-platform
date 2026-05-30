import { http } from './httpClient';
import type { PaginatedResult, SopDetailDto, SopDto } from './types';

export interface ListSopsParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
  readonly active?: boolean | undefined;
}

export interface CreateSopRequest {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly fullText: string;
}

export interface CreateSopVersionRequest {
  readonly fullText: string;
}

export interface UpdateSopRequest {
  readonly name?: string;
  readonly description?: string;
  readonly active?: boolean;
}

/** Backed by `GET/POST /sops`, `GET/PATCH /sops/:id`, `POST /sops/:id/versions`. */
export function listSops(params: ListSopsParams = {}): Promise<PaginatedResult<SopDto>> {
  return http.get<PaginatedResult<SopDto>>('/sops', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 50,
      ...(params.search ? { search: params.search } : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
    },
  });
}

export function getSop(id: string): Promise<SopDto> {
  return http.get<SopDto>(`/sops/${id}`);
}

export function createSop(body: CreateSopRequest): Promise<SopDto> {
  return http.post<SopDto>('/sops', body);
}

/** Editing an existing SOP creates a new immutable detail version (never overwrites). */
export function createSopVersion(id: string, body: CreateSopVersionRequest): Promise<SopDetailDto> {
  return http.post<SopDetailDto>(`/sops/${id}/versions`, body);
}

export function updateSop(id: string, body: UpdateSopRequest): Promise<SopDto> {
  return http.patch<SopDto>(`/sops/${id}`, body);
}
