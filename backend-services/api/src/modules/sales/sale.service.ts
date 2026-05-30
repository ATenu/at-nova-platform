import { NotFoundError, ValidationError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import { computeReceiptTotalCents, decimalToScaledBigInt, scaledBigIntToDecimal } from '../../lib/money';
import type { CustomerRepository } from '../customers/customer.repository';
import type { ProductRepository } from '../products/product.repository';
import { toSaleDto, type SaleDto } from './sale.dto';
import type { CreateSaleData, SaleListFilter, SaleRepository } from './sale.repository';

export interface CreateSaleInput {
  readonly customerId: string;
  readonly date: string;
  readonly discountApplied: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment: string | null;
  readonly items: readonly { readonly productId: string; readonly quantity: number }[];
}

export class SaleService {
  constructor(
    private readonly sales: SaleRepository,
    private readonly products: ProductRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async listSales(filter: SaleListFilter): Promise<PaginatedResult<SaleDto>> {
    const { items, total } = await this.sales.findPaginated(filter);
    return buildPaginatedResult(
      items.map((sale) => toSaleDto(sale)),
      total,
      filter,
    );
  }

  async getSaleById(id: string): Promise<SaleDto> {
    const sale = await this.sales.findById(id);
    if (!sale) {
      throw new NotFoundError('Sale not found.');
    }
    return toSaleDto(sale);
  }

  async createSale(input: CreateSaleInput): Promise<SaleDto> {
    const customer = await this.customers.findById(input.customerId);
    if (!customer) {
      throw new ValidationError('The selected customer does not exist.');
    }

    const productIds = input.items.map((item) => item.productId);
    const products = await this.products.findByIds(productIds);
    const priceById = new Map(products.map((product) => [product.id, product.price]));

    const lines = input.items.map((item) => {
      const price = priceById.get(item.productId);
      if (price === undefined) {
        throw new ValidationError(`Product ${item.productId} does not exist.`);
      }
      return { priceCents: decimalToScaledBigInt(price, 2), quantity: item.quantity };
    });

    const totalCents = computeReceiptTotalCents(lines, input.discountApplied);

    const data: CreateSaleData = {
      customerId: input.customerId,
      date: new Date(input.date),
      discountApplied: input.discountApplied,
      totalAmountReceipt: scaledBigIntToDecimal(totalCents, 2),
      paymentReceived: input.paymentReceived,
      dateOfPayment: input.dateOfPayment ? new Date(input.dateOfPayment) : null,
      items: input.items,
    };

    const id = await this.sales.create(data);
    return this.getSaleById(id);
  }
}
