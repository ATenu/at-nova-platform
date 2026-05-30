/** Standard pagination request, validated at the route boundary. */
export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** Standard paginated envelope returned by list endpoints. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function buildPaginatedResult<T>(
  items: readonly T[],
  total: number,
  page: PageRequest,
): PaginatedResult<T> {
  return {
    items,
    total,
    page: page.page,
    pageSize: page.pageSize,
    totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
  };
}
