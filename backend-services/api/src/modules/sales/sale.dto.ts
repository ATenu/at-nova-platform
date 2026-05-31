import type { ProductSold, Sale } from '@nova/database';
import { toCustomerDto, type CustomerDto } from '../customers/customer.dto';
import { toProductDto, type ProductDto } from '../products/product.dto';

export interface ProductSoldDto {
  readonly saleId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly product?: ProductDto | undefined;
}

export interface SaleDto {
  readonly id: string;
  readonly customerId: string;
  readonly customer?: CustomerDto | undefined;
  readonly discountApplied: string | null;
  readonly date: string;
  readonly totalAmountReceipt: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment: string | null;
  readonly productsSold?: readonly ProductSoldDto[] | undefined;
  readonly issuesCount?: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A distinct product a customer purchased, with quantity/sale totals. */
export interface CustomerProductPurchaseDto {
  readonly productId: string;
  readonly name: string;
  readonly category: string;
  readonly price: string;
  readonly totalQuantity: number;
  readonly saleCount: number;
}

/** The full set of products a customer has purchased across their sales. */
export interface CustomerProductsDto {
  readonly customerId: string;
  readonly products: readonly CustomerProductPurchaseDto[];
  readonly totalProducts: number;
}

export function toProductSoldDto(productSold: ProductSold): ProductSoldDto {
  return {
    saleId: productSold.saleId,
    productId: productSold.productId,
    quantity: productSold.quantity,
    product: productSold.product ? toProductDto(productSold.product) : undefined,
  };
}

export interface SaleDtoOptions {
  readonly issuesCount?: number;
}

export function toSaleDto(sale: Sale, options: SaleDtoOptions = {}): SaleDto {
  return {
    id: sale.id,
    customerId: sale.customerId,
    customer: sale.customer ? toCustomerDto(sale.customer) : undefined,
    discountApplied: sale.discountApplied,
    date: sale.date.toISOString(),
    totalAmountReceipt: sale.totalAmountReceipt,
    paymentReceived: sale.paymentReceived,
    dateOfPayment: sale.dateOfPayment ? sale.dateOfPayment.toISOString() : null,
    productsSold: sale.productsSold ? sale.productsSold.map(toProductSoldDto) : undefined,
    issuesCount: options.issuesCount,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
  };
}
