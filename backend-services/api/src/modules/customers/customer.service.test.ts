import { NotFoundError } from '@nova/shared';
import type { Customer } from '@nova/database';
import { CustomerService } from './customer.service';
import type { CustomerRepository } from './customer.repository';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date('2026-05-01T00:00:00.000Z');
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'a@test.com',
    fullName: 'A Test',
    firstName: 'A',
    lastName: 'Test',
    age: 30,
    active: true,
    createdAt: now,
    updatedAt: now,
    sales: [],
    ...overrides,
  } as Customer;
}

describe('CustomerService', () => {
  it('maps entities to DTOs and paginates', async () => {
    const repository = {
      findPaginated: jest.fn().mockResolvedValue({ items: [makeCustomer()], total: 1 }),
      findById: jest.fn(),
    } as unknown as CustomerRepository;

    const service = new CustomerService(repository);
    const result = await service.listCustomers({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items[0]).toMatchObject({ email: 'a@test.com', createdAt: expect.any(String) });
    // DTO must not expose the relation array from the entity.
    expect(result.items[0]).not.toHaveProperty('sales');
  });

  it('throws NotFoundError for a missing customer', async () => {
    const repository = {
      findPaginated: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as CustomerRepository;

    const service = new CustomerService(repository);
    await expect(service.getCustomerById('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
