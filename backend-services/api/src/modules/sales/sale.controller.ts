import type { Request, Response } from 'express';
import type { SaleService } from './sale.service';
import type { CreateSaleBody, ListSalesQuery, SaleIdParams } from './sale.schema';

export class SaleController {
  constructor(private readonly service: SaleService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListSalesQuery;
    const result = await this.service.listSales({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
      ...(query.paymentReceived !== undefined ? { paymentReceived: query.paymentReceived } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
    res.json(result);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as SaleIdParams;
    res.json(await this.service.getSaleById(id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CreateSaleBody;
    const sale = await this.service.createSale({
      customerId: body.customerId,
      date: body.date,
      discountApplied: body.discountApplied,
      paymentReceived: body.paymentReceived,
      dateOfPayment: body.dateOfPayment ?? null,
      items: body.items,
    });
    res.status(201).json(sale);
  };
}
