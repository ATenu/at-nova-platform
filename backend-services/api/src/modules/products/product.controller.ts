import type { Request, Response } from 'express';
import type { ProductService } from './product.service';
import type { ListProductsQuery } from './product.schema';

export class ProductController {
  constructor(private readonly service: ProductService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListProductsQuery;
    const result = await this.service.listProducts({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.inCatalog !== undefined ? { inCatalog: query.inCatalog } : {}),
    });
    res.json(result);
  };
}
