import { ProductSold, Sale } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface SaleListFilter extends PageRequest {
  readonly customerId?: string;
  readonly paymentReceived?: boolean;
  readonly from?: string;
  readonly to?: string;
}

export interface SaleListResult {
  readonly items: Sale[];
  readonly total: number;
}

/** One product a customer purchased, aggregated across all of their sales. */
export interface CustomerProductAggregate {
  readonly productId: string;
  readonly name: string;
  readonly category: string;
  readonly price: string;
  readonly totalQuantity: number;
  readonly saleCount: number;
}

export interface CreateSaleData {
  readonly customerId: string;
  readonly date: Date;
  readonly discountApplied: string;
  readonly totalAmountReceipt: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment: Date | null;
  readonly items: readonly { readonly productId: string; readonly quantity: number }[];
}

export class SaleRepository {
  private readonly sales: Repository<Sale>;

  constructor(private readonly dataSource: DataSource) {
    this.sales = dataSource.getRepository(Sale);
  }

  async findPaginated(filter: SaleListFilter): Promise<SaleListResult> {
    const query = this.sales
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.customer', 'customer');

    if (filter.customerId) {
      query.andWhere('sale.customer_id = :customerId', { customerId: filter.customerId });
    }
    if (filter.paymentReceived !== undefined) {
      query.andWhere('sale.payment_received = :paid', { paid: filter.paymentReceived });
    }
    if (filter.from) {
      query.andWhere('sale.date >= :from', { from: filter.from });
    }
    if (filter.to) {
      query.andWhere('sale.date <= :to', { to: filter.to });
    }

    query
      .orderBy('sale.date', 'DESC')
      .addOrderBy('sale.id', 'DESC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<Sale | null> {
    return this.sales.findOne({
      where: { id },
      relations: { customer: true, productsSold: { product: true } },
    });
  }

  /**
   * Aggregate the distinct products a customer purchased across all their sales
   * in a single grouped query (no N+1). Quantities are summed and the number of
   * distinct sales each product appears in is counted.
   */
  async aggregateProductsForCustomer(customerId: string): Promise<CustomerProductAggregate[]> {
    const rows = await this.dataSource
      .getRepository(ProductSold)
      .createQueryBuilder('line')
      .innerJoin('line.sale', 'sale')
      .innerJoin('line.product', 'product')
      .where('sale.customer_id = :customerId', { customerId })
      .select('product.id', 'productId')
      .addSelect('product.name', 'name')
      .addSelect('product.category', 'category')
      .addSelect('product.price', 'price')
      .addSelect('SUM(line.quantity)', 'totalQuantity')
      .addSelect('COUNT(DISTINCT sale.id)', 'saleCount')
      .groupBy('product.id')
      .addGroupBy('product.name')
      .addGroupBy('product.category')
      .addGroupBy('product.price')
      .orderBy('product.name', 'ASC')
      .getRawMany<{
        productId: string;
        name: string;
        category: string;
        price: string;
        totalQuantity: string;
        saleCount: string;
      }>();
    // Postgres returns SUM/COUNT as strings; coerce to numbers at this boundary.
    return rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      category: row.category,
      price: row.price,
      totalQuantity: Number(row.totalQuantity),
      saleCount: Number(row.saleCount),
    }));
  }

  async create(data: CreateSaleData): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const saleRepo = manager.getRepository(Sale);
      const lineRepo = manager.getRepository(ProductSold);
      const sale = saleRepo.create({
        customerId: data.customerId,
        date: data.date,
        discountApplied: data.discountApplied,
        totalAmountReceipt: data.totalAmountReceipt,
        paymentReceived: data.paymentReceived,
        dateOfPayment: data.dateOfPayment,
      });
      const saved = await saleRepo.save(sale);
      await lineRepo.insert(
        data.items.map((item) => ({
          saleId: saved.id,
          productId: item.productId,
          quantity: item.quantity,
        })),
      );
      return saved.id;
    });
  }
}
