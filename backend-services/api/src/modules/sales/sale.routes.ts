import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { SaleController } from './sale.controller';
import type { SaleService } from './sale.service';
import { createSaleBodySchema, listSalesQuerySchema, saleIdParamsSchema } from './sale.schema';

const listSalesPolicy = defineRoutePolicy({ routeId: 'sales.list', permission: 'read-sales', audit: true });
const getSalePolicy = defineRoutePolicy({ routeId: 'sales.get', permission: 'read-sales', audit: true });
const createSalePolicy = defineRoutePolicy({
  routeId: 'sales.create',
  permission: 'write-sales',
  audit: true,
});

export interface SaleRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: SaleService;
}

export function createSaleRouter(deps: SaleRouterDeps): Router {
  const router = Router();
  const controller = new SaleController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listSalesPolicy),
    validateRequest({ query: listSalesQuerySchema }),
    asyncHandler(controller.list),
  );

  router.post(
    '/',
    deps.authenticate,
    authorize(createSalePolicy),
    validateRequest({ body: createSaleBodySchema }),
    asyncHandler(controller.create),
  );

  router.get(
    '/:id',
    deps.authenticate,
    authorize(getSalePolicy),
    validateRequest({ params: saleIdParamsSchema }),
    asyncHandler(controller.getById),
  );

  return router;
}
