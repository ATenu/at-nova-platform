import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { ProductController } from './product.controller';
import type { ProductService } from './product.service';
import { listProductsQuerySchema } from './product.schema';

const listProductsPolicy = defineRoutePolicy({
  routeId: 'products.list',
  permission: 'read-sales',
  audit: true,
});

export interface ProductRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: ProductService;
}

export function createProductRouter(deps: ProductRouterDeps): Router {
  const router = Router();
  const controller = new ProductController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listProductsPolicy),
    validateRequest({ query: listProductsQuerySchema }),
    asyncHandler(controller.list),
  );

  return router;
}
