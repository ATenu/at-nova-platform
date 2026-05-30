import { http } from './httpClient';
import type { PaginatedResult, SaleDto } from './types';

export interface ListSalesParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly customerId?: string | undefined;
  readonly paymentReceived?: boolean | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface CreateSaleItem {
  readonly productId: string;
  readonly quantity: number;
}

export interface CreateSaleRequest {
  readonly customerId: string;
  readonly date: string;
  readonly discountApplied: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment?: string | null;
  readonly items: readonly CreateSaleItem[];
  /** Receipt total, normalized to a two-decimal string by the client. */
  readonly totalAmountReceipt: string;
}

/** Backed by `GET/POST /sales`, `GET /sales/:id`. Mock mode mirrors the API. */
export function listSales(params: ListSalesParams = {}): Promise<PaginatedResult<SaleDto>> {
  return http.get<PaginatedResult<SaleDto>>('/sales', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.paymentReceived !== undefined ? { paymentReceived: params.paymentReceived } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
  });
}

export function getSale(id: string): Promise<SaleDto> {
  return http.get<SaleDto>(`/sales/${id}`);
}

export function createSale(body: CreateSaleRequest): Promise<SaleDto> {
  return http.post<SaleDto>('/sales', body);
}
