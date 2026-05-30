import { ValidationError } from '@nova/shared';
import type { Customer, Product } from '@nova/database';
import { SaleService } from './sale.service';
import type { CreateSaleData, SaleRepository } from './sale.repository';
import type { ProductRepository } from '../products/product.repository';
import type { CustomerRepository } from '../customers/customer.repository';

function product(id: string, price: string): Product {
  return { id, price } as Product;
}

function buildService(captured: { data?: CreateSaleData }) {
  const sales = {
    create: jest.fn(async (data: CreateSaleData) => {
      captured.data = data;
      return 'sale-1';
    }),
    findById: jest.fn().mockResolvedValue({
      id: 'sale-1',
      customerId: 'c1',
      discountApplied: '10.00',
      date: new Date('2026-05-20T10:30:00.000Z'),
      totalAmountReceipt: captured.data?.totalAmountReceipt ?? '0.00',
      paymentReceived: true,
      dateOfPayment: new Date('2026-05-20T10:35:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      productsSold: [],
    }),
  } as unknown as SaleRepository;
  const products = {
    findByIds: jest.fn().mockResolvedValue([product('p-alpha', '200.00'), product('p-delta', '15.00')]),
  } as unknown as ProductRepository;
  const customers = {
    findById: jest.fn().mockResolvedValue({ id: 'c1' } as Customer),
  } as unknown as CustomerRepository;
  return { service: new SaleService(sales, products, customers), sales, products, customers };
}

describe('SaleService.createSale', () => {
  it('computes the receipt total server-side and ignores any client total', async () => {
    const captured: { data?: CreateSaleData } = {};
    const { service } = buildService(captured);

    await service.createSale({
      customerId: 'c1',
      date: '2026-05-20T10:30:00.000Z',
      discountApplied: '10.00',
      paymentReceived: true,
      dateOfPayment: '2026-05-20T10:35:00.000Z',
      items: [
        { productId: 'p-alpha', quantity: 1 },
        { productId: 'p-delta', quantity: 2 },
      ],
    });

    expect(captured.data?.totalAmountReceipt).toBe('207.00');
  });

  it('rejects a sale referencing an unknown customer', async () => {
    const { service, customers } = buildService({});
    (customers.findById as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.createSale({
        customerId: 'missing',
        date: '2026-05-20T10:30:00.000Z',
        discountApplied: '0.00',
        paymentReceived: false,
        dateOfPayment: null,
        items: [{ productId: 'p-alpha', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a sale referencing an unknown product', async () => {
    const { service, products } = buildService({});
    (products.findByIds as jest.Mock).mockResolvedValueOnce([]);

    await expect(
      service.createSale({
        customerId: 'c1',
        date: '2026-05-20T10:30:00.000Z',
        discountApplied: '0.00',
        paymentReceived: false,
        dateOfPayment: null,
        items: [{ productId: 'ghost', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
