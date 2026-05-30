import { http } from './httpClient';
import type { PaginatedResult, ProductDto } from './types';

export interface ListProductsParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
}

/** TODO(backend): `GET /products`. Mocked locally until implemented. */
export function listProducts(
  params: ListProductsParams = {},
): Promise<PaginatedResult<ProductDto>> {
  return http.get<PaginatedResult<ProductDto>>('/products', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 50,
      ...(params.search ? { search: params.search } : {}),
    },
  });
}
