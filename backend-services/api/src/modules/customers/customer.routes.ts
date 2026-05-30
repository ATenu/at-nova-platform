import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { CustomerController } from './customer.controller';
import type { CustomerService } from './customer.service';
import { customerIdParamsSchema, listCustomersQuerySchema } from './customer.schema';

const listCustomersPolicy = defineRoutePolicy({
  routeId: 'customers.list',
  permission: 'read-customers',
  audit: true,
});

const getCustomerPolicy = defineRoutePolicy({
  routeId: 'customers.get',
  permission: 'read-customers',
  audit: true,
});

export interface CustomerRouterDeps {
  readonly authenticate: RequestHandler;
  readonly service: CustomerService;
}

/** Build the customers router. Every route is authenticated and authorized. */
export function createCustomerRouter(deps: CustomerRouterDeps): Router {
  const router = Router();
  const controller = new CustomerController(deps.service);

  router.get(
    '/',
    deps.authenticate,
    authorize(listCustomersPolicy),
    validateRequest({ query: listCustomersQuerySchema }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:id',
    deps.authenticate,
    authorize(getCustomerPolicy),
    validateRequest({ params: customerIdParamsSchema }),
    asyncHandler(controller.getById),
  );

  return router;
}
