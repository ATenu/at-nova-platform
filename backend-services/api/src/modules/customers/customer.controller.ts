import type { Request, Response } from 'express';
import type { CustomerService } from './customer.service';
import type { CustomerIdParams, ListCustomersQuery } from './customer.schema';

/**
 * Thin customer controller: maps validated request data to service calls and
 * service results to responses. No business logic or data access here.
 */
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListCustomersQuery;
    const result = await this.service.listCustomers({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
    });
    res.json(result);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as CustomerIdParams;
    const customer = await this.service.getCustomerById(id);
    res.json(customer);
  };
}
