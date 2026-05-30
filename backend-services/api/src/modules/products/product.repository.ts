import { Product } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface ProductListFilter extends PageRequest {
  readonly search?: string;
  readonly category?: string;
  readonly inCatalog?: boolean;
}

export interface ProductListResult {
  readonly items: Product[];
  readonly total: number;
}

export class ProductRepository {
  private readonly products: Repository<Product>;

  constructor(dataSource: DataSource) {
    this.products = dataSource.getRepository(Product);
  }

  async findPaginated(filter: ProductListFilter): Promise<ProductListResult> {
    const query = this.products.createQueryBuilder('product');

    if (filter.search) {
      query.andWhere('(product.name ILIKE :search OR product.description ILIKE :search)', {
        search: `%${filter.search}%`,
      });
    }
    if (filter.category) {
      query.andWhere('product.category = :category', { category: filter.category });
    }
    if (filter.inCatalog !== undefined) {
      query.andWhere('product.in_catalog = :inCatalog', { inCatalog: filter.inCatalog });
    }

    query
      .orderBy('product.name', 'ASC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.findOne({ where: { id } });
  }

  async findByIds(ids: readonly string[]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.products.createQueryBuilder('product').whereInIds([...ids]).getMany();
  }
}
