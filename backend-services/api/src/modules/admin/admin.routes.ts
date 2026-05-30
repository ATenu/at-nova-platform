import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { AdminUserController } from './admin-user.controller';
import { RbacController } from './rbac.controller';
import type { AdminUserService } from './admin-user.service';
import type { RbacService } from './rbac.service';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  setRolesBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from './admin.schema';

const listUsersPolicy = defineRoutePolicy({ routeId: 'admin.users.list', permission: 'read-users', audit: true });
const getUserPolicy = defineRoutePolicy({ routeId: 'admin.users.get', permission: 'read-users', audit: true });
const createUserPolicy = defineRoutePolicy({ routeId: 'admin.users.create', permission: 'write-users', audit: true });
const updateUserPolicy = defineRoutePolicy({ routeId: 'admin.users.update', permission: 'write-users', audit: true });
const setRolesPolicy = defineRoutePolicy({ routeId: 'admin.users.setRoles', permission: 'write-users', audit: true });
const syncUserPolicy = defineRoutePolicy({ routeId: 'admin.users.syncKeycloak', permission: 'write-users', audit: true });

const listRolesPolicy = defineRoutePolicy({ routeId: 'admin.roles.list', permission: 'read-permissions', audit: true });
const listPermissionsPolicy = defineRoutePolicy({ routeId: 'admin.permissions.list', permission: 'read-permissions', audit: true });
const matrixPolicy = defineRoutePolicy({ routeId: 'admin.rolePermissions.get', permission: 'read-permissions', audit: true });

export interface AdminRouterDeps {
  readonly authenticate: RequestHandler;
  readonly userService: AdminUserService;
  readonly rbacService: RbacService;
}

/** Build the `/admin` router (user management + read-only RBAC matrix). */
export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const users = new AdminUserController(deps.userService);
  const rbac = new RbacController(deps.rbacService);

  router.get(
    '/users',
    deps.authenticate,
    authorize(listUsersPolicy),
    validateRequest({ query: listUsersQuerySchema }),
    asyncHandler(users.list),
  );
  router.post(
    '/users',
    deps.authenticate,
    authorize(createUserPolicy),
    validateRequest({ body: createUserBodySchema }),
    asyncHandler(users.create),
  );
  router.get(
    '/users/:id',
    deps.authenticate,
    authorize(getUserPolicy),
    validateRequest({ params: userIdParamsSchema }),
    asyncHandler(users.getById),
  );
  router.patch(
    '/users/:id',
    deps.authenticate,
    authorize(updateUserPolicy),
    validateRequest({ params: userIdParamsSchema, body: updateUserBodySchema }),
    asyncHandler(users.update),
  );
  router.put(
    '/users/:id/roles',
    deps.authenticate,
    authorize(setRolesPolicy),
    validateRequest({ params: userIdParamsSchema, body: setRolesBodySchema }),
    asyncHandler(users.setRoles),
  );
  router.post(
    '/users/:id/sync-keycloak',
    deps.authenticate,
    authorize(syncUserPolicy),
    validateRequest({ params: userIdParamsSchema }),
    asyncHandler(users.syncKeycloak),
  );

  router.get('/roles', deps.authenticate, authorize(listRolesPolicy), asyncHandler(rbac.listRoles));
  router.get(
    '/permissions',
    deps.authenticate,
    authorize(listPermissionsPolicy),
    asyncHandler(rbac.listPermissions),
  );
  router.get(
    '/role-permissions',
    deps.authenticate,
    authorize(matrixPolicy),
    asyncHandler(rbac.getMatrix),
  );

  return router;
}
