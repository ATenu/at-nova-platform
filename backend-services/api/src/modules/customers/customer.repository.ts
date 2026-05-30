import { Customer } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface CustomerListFilter extends PageRequest {
  readonly active?: boolean;
  readonly search?: string;
}

export interface CustomerListResult {
  readonly items: Customer[];
  readonly total: number;
}

/**
 * Data-access for customers. Encapsulates all TypeORM usage behind a typed
 * interface; queries are parameterized and lists are always paginated.
 */
export class CustomerRepository {
  private readonly repository: Repository<Customer>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(Customer);
  }

  async findPaginated(filter: CustomerListFilter): Promise<CustomerListResult> {
    const query = this.repository.createQueryBuilder('customer');

    if (filter.active !== undefined) {
      query.andWhere('customer.active = :active', { active: filter.active });
    }
    if (filter.search) {
      query.andWhere('(customer.full_name ILIKE :search OR customer.email ILIKE :search)', {
        search: `%${filter.search}%`,
      });
    }

    query
      .orderBy('customer.createdAt', 'DESC')
      .addOrderBy('customer.id', 'DESC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<Customer | null> {
    return this.repository.findOne({ where: { id } });
  }
}
