import { ValidationError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { CapabilityExecutor, type CapabilityServices } from './capability-executor';

const ACTION_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

function auth(): AuthContext {
  return {
    subject: 'kc-1',
    issuer: '',
    audience: [],
    roles: ['support-operations-user'],
    permissions: new Set(['read-customers', 'write-actions']),
    scopes: [],
  } as unknown as AuthContext;
}

interface MockServices {
  readonly customers: { listCustomers: jest.Mock; getCustomerById: jest.Mock };
  readonly products: { listProducts: jest.Mock; getProductById: jest.Mock };
  readonly sales: { listSales: jest.Mock; getSaleById: jest.Mock; productsForCustomer: jest.Mock };
  readonly issues: { listIssues: jest.Mock; getIssueById: jest.Mock; updateIssue: jest.Mock };
  readonly actions: { addComment: jest.Mock; updateAction: jest.Mock };
  readonly sops: Record<string, jest.Mock>;
}

function executor(): { executor: CapabilityExecutor; services: MockServices } {
  const services: MockServices = {
    customers: {
      listCustomers: jest.fn(async () => ({
        items: [{ id: CUSTOMER_ID, fullName: 'Jane Doe', email: 'jane@example.com', active: true }],
        total: 1,
      })),
      getCustomerById: jest.fn(async () => ({
        id: CUSTOMER_ID,
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        active: true,
      })),
    },
    products: { listProducts: jest.fn(), getProductById: jest.fn() },
    sales: {
      listSales: jest.fn(),
      getSaleById: jest.fn(),
      productsForCustomer: jest.fn(async () => ({
        customerId: CUSTOMER_ID,
        products: [
          { productId: 'p-1', name: 'Alpha', category: 'core', price: '200.00', totalQuantity: 3, saleCount: 2 },
          { productId: 'p-2', name: 'Beta', category: 'core', price: '50.00', totalQuantity: 1, saleCount: 1 },
        ],
        totalProducts: 2,
      })),
    },
    issues: { listIssues: jest.fn(), getIssueById: jest.fn(), updateIssue: jest.fn() },
    actions: {
      addComment: jest.fn(async () => ({ id: 'cm-1', comment: 'looks good' })),
      updateAction: jest.fn(async () => ({ id: ACTION_ID, title: 'Investigate', status: 'in_progress' })),
    },
    sops: {},
  };
  return {
    executor: new CapabilityExecutor(services as unknown as CapabilityServices),
    services,
  };
}

describe('CapabilityExecutor resolvers', () => {
  it('customers.search returns matches with ids the reasoner can reuse', async () => {
    const { executor: exec, services } = executor();
    const result = await exec.execute('customers.search', { search: 'Jane' }, auth());
    expect(services.customers.listCustomers).toHaveBeenCalled();
    expect(result.capabilityId).toBe('customers.search');
    // The id must be surfaced (in data and summary) so the next hop can use it.
    expect(JSON.stringify(result.data)).toContain(CUSTOMER_ID);
    expect(result.summary).toContain(CUSTOMER_ID);
    expect(result.links[0]).toMatchObject({ href: `nova://customer/${CUSTOMER_ID}`, type: 'customer' });
  });

  it('customers.get rejects a non-uuid id', async () => {
    const { executor: exec } = executor();
    await expect(exec.execute('customers.get', { customerId: 'not-a-uuid' }, auth())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('sales.products.forCustomer resolves the customer then aggregates their products', async () => {
    const { executor: exec, services } = executor();
    const result = await exec.execute('sales.products.forCustomer', { customerId: CUSTOMER_ID }, auth());
    // Resource-scoped: the customer is resolved (existence-checked) first.
    expect(services.customers.getCustomerById).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(services.sales.productsForCustomer).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(result.capabilityId).toBe('sales.products.forCustomer');
    expect(result.summary).toContain('2 distinct product(s)');
    expect(result.summary).toContain('Alpha');
    expect(JSON.stringify(result.data)).toContain('p-1');
  });

  it('sales.products.forCustomer rejects a non-uuid customer id', async () => {
    const { executor: exec } = executor();
    await expect(
      exec.execute('sales.products.forCustomer', { customerId: 'not-a-uuid' }, auth()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('CapabilityExecutor writes', () => {
  it('actions.addComment delegates to the service with a server-side datetime', async () => {
    const { executor: exec, services } = executor();
    await exec.execute('actions.addComment', { actionId: ACTION_ID, comment: 'looks good' }, auth());
    expect(services.actions.addComment).toHaveBeenCalledTimes(1);
    const call = services.actions.addComment.mock.calls[0] as [string, { comment: string; datetime: string }];
    const [calledId, input] = call;
    expect(calledId).toBe(ACTION_ID);
    expect(input.comment).toBe('looks good');
    // The client cannot spoof the timestamp; it is generated here as an ISO string.
    expect(() => new Date(input.datetime).toISOString()).not.toThrow();
  });

  it('actions.addComment rejects an empty comment', async () => {
    const { executor: exec } = executor();
    await expect(
      exec.execute('actions.addComment', { actionId: ACTION_ID, comment: '   ' }, auth()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('actions.update requires at least one field to change', async () => {
    const { executor: exec } = executor();
    await expect(exec.execute('actions.update', { actionId: ACTION_ID }, auth())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('actions.update applies the provided status', async () => {
    const { executor: exec, services } = executor();
    const result = await exec.execute(
      'actions.update',
      { actionId: ACTION_ID, status: 'in_progress' },
      auth(),
    );
    expect(services.actions.updateAction).toHaveBeenCalledWith(
      ACTION_ID,
      { status: 'in_progress' },
      expect.anything(),
    );
    expect(result.capabilityId).toBe('actions.update');
  });

  it('rejects a capability with no executor (default deny)', async () => {
    const { executor: exec } = executor();
    await expect(exec.execute('unknown.capability', {}, auth())).rejects.toBeInstanceOf(ValidationError);
  });
});
