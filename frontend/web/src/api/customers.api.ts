import { http } from './httpClient';
import type { CustomerDto, PaginatedResult } from './types';

export interface ListCustomersParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
  readonly active?: boolean | undefined;
}

/** Backed by the existing `GET /api/v1/customers` endpoint. */
export function listCustomers(
  params: ListCustomersParams = {},
): Promise<PaginatedResult<CustomerDto>> {
  return http.get<PaginatedResult<CustomerDto>>('/customers', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.search ? { search: params.search } : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
    },
  });
}

export function getCustomer(id: string): Promise<CustomerDto> {
  return http.get<CustomerDto>(`/customers/${id}`);
}

export interface UpsertCustomerRequest {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly age?: number | null;
  readonly active: boolean;
}

/** TODO(backend): customer mutations are not yet implemented server-side. */
export function createCustomer(body: UpsertCustomerRequest): Promise<CustomerDto> {
  return http.post<CustomerDto>('/customers', body);
}

export function updateCustomer(
  id: string,
  body: Partial<UpsertCustomerRequest>,
): Promise<CustomerDto> {
  return http.patch<CustomerDto>(`/customers/${id}`, body);
}
