import { NotFoundError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import { toCustomerDto, type CustomerDto } from './customer.dto';
import type { CustomerListFilter, CustomerRepository } from './customer.repository';

/**
 * Customer use cases. Holds business rules, returns DTOs (never entities), and
 * is free of any HTTP concerns.
 */
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  async listCustomers(filter: CustomerListFilter): Promise<PaginatedResult<CustomerDto>> {
    const { items, total } = await this.repository.findPaginated(filter);
    return buildPaginatedResult(items.map(toCustomerDto), total, filter);
  }

  async getCustomerById(id: string): Promise<CustomerDto> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundError('Customer not found.');
    }
    return toCustomerDto(customer);
  }
}
