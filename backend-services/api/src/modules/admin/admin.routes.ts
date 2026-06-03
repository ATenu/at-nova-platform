import { Router, type RequestHandler } from 'express';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';
import { validateRequest } from '../../http/validate';
import { AdminUserController } from './admin-user.controller';
import { RbacController } from './rbac.controller';
import { RbacAdminController } from './rbac-admin.controller';
import type { AdminUserService } from './admin-user.service';
import type { RbacService } from './rbac.service';
import type { RbacAdminService } from './rbac-admin.service';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  setRolesBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from './admin.schema';
import {
  capabilityIdParamsSchema,
  createCapabilityBodySchema,
  createPermissionBodySchema,
  createRoleBodySchema,
  permissionNameParamsSchema,
  roleNameParamsSchema,
  routeIdParamsSchema,
  setRolePermissionsBodySchema,
  updateCapabilityBodySchema,
  updatePermissionBodySchema,
  updateRoleBodySchema,
  updateRoutePolicyBodySchema,
  updateViewPermissionBodySchema,
  viewPermissionParamsSchema,
} from './rbac-admin.schema';

const listUsersPolicy = defineRoutePolicy({ routeId: 'admin.users.list', permission: 'read-users', audit: true });
const getUserPolicy = defineRoutePolicy({ routeId: 'admin.users.get', permission: 'read-users', audit: true });
const createUserPolicy = defineRoutePolicy({ routeId: 'admin.users.create', permission: 'write-users', audit: true });
const updateUserPolicy = defineRoutePolicy({ routeId: 'admin.users.update', permission: 'write-users', audit: true });
const setRolesPolicy = defineRoutePolicy({ routeId: 'admin.users.setRoles', permission: 'write-users', audit: true });
const syncUserPolicy = defineRoutePolicy({ routeId: 'admin.users.syncKeycloak', permission: 'write-users', audit: true });

// RBAC reads (read-permissions); RBAC mutations (write-permissions). All audited.
const listRolesPolicy = defineRoutePolicy({ routeId: 'admin.roles.list', permission: 'read-permissions', audit: true });
const listPermissionsPolicy = defineRoutePolicy({ routeId: 'admin.permissions.list', permission: 'read-permissions', audit: true });
const matrixPolicy = defineRoutePolicy({ routeId: 'admin.rolePermissions.get', permission: 'read-permissions', audit: true });
const listCapabilitiesPolicy = defineRoutePolicy({ routeId: 'admin.capabilities.list', permission: 'read-permissions', audit: true });
const listRoutePoliciesPolicy = defineRoutePolicy({ routeId: 'admin.routePolicies.list', permission: 'read-permissions', audit: true });
const listViewPermissionsPolicy = defineRoutePolicy({ routeId: 'admin.viewPermissions.list', permission: 'read-permissions', audit: true });

const createRolePolicy = defineRoutePolicy({ routeId: 'admin.roles.create', permission: 'write-permissions', audit: true });
const updateRolePolicy = defineRoutePolicy({ routeId: 'admin.roles.update', permission: 'write-permissions', audit: true });
const deleteRolePolicy = defineRoutePolicy({ routeId: 'admin.roles.delete', permission: 'write-permissions', audit: true });
const setRolePermissionsPolicy = defineRoutePolicy({ routeId: 'admin.roles.setPermissions', permission: 'write-permissions', audit: true });
const createPermissionPolicy = defineRoutePolicy({ routeId: 'admin.permissions.create', permission: 'write-permissions', audit: true });
const updatePermissionPolicy = defineRoutePolicy({ routeId: 'admin.permissions.update', permission: 'write-permissions', audit: true });
const deletePermissionPolicy = defineRoutePolicy({ routeId: 'admin.permissions.delete', permission: 'write-permissions', audit: true });
const createCapabilityPolicy = defineRoutePolicy({ routeId: 'admin.capabilities.create', permission: 'write-permissions', audit: true });
const updateCapabilityPolicy = defineRoutePolicy({ routeId: 'admin.capabilities.update', permission: 'write-permissions', audit: true });
const deleteCapabilityPolicy = defineRoutePolicy({ routeId: 'admin.capabilities.delete', permission: 'write-permissions', audit: true });
const updateRoutePolicyPolicy = defineRoutePolicy({ routeId: 'admin.routePolicies.update', permission: 'write-permissions', audit: true });
const updateViewPermissionPolicy = defineRoutePolicy({ routeId: 'admin.viewPermissions.update', permission: 'write-permissions', audit: true });

export interface AdminRouterDeps {
  readonly authenticate: RequestHandler;
  readonly userService: AdminUserService;
  readonly rbacService: RbacService;
  readonly rbacAdminService: RbacAdminService;
}

/** Build the `/admin` router (user management + DB-driven RBAC administration). */
export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const users = new AdminUserController(deps.userService);
  const rbac = new RbacController(deps.rbacService);
  const rbacAdmin = new RbacAdminController(deps.rbacAdminService);

  // --- User management ---
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

  // --- RBAC reads ---
  router.get('/roles', deps.authenticate, authorize(listRolesPolicy), asyncHandler(rbac.listRoles));
  router.get('/permissions', deps.authenticate, authorize(listPermissionsPolicy), asyncHandler(rbac.listPermissions));
  router.get('/role-permissions', deps.authenticate, authorize(matrixPolicy), asyncHandler(rbac.getMatrix));
  router.get('/capabilities', deps.authenticate, authorize(listCapabilitiesPolicy), asyncHandler(rbac.listCapabilities));
  router.get('/route-policies', deps.authenticate, authorize(listRoutePoliciesPolicy), asyncHandler(rbac.listRoutePolicies));
  router.get('/view-permissions', deps.authenticate, authorize(listViewPermissionsPolicy), asyncHandler(rbac.listViewPermissions));

  // --- RBAC mutations (roles) ---
  router.post(
    '/roles',
    deps.authenticate,
    authorize(createRolePolicy),
    validateRequest({ body: createRoleBodySchema }),
    asyncHandler(rbacAdmin.createRole),
  );
  router.patch(
    '/roles/:name',
    deps.authenticate,
    authorize(updateRolePolicy),
    validateRequest({ params: roleNameParamsSchema, body: updateRoleBodySchema }),
    asyncHandler(rbacAdmin.updateRole),
  );
  router.delete(
    '/roles/:name',
    deps.authenticate,
    authorize(deleteRolePolicy),
    validateRequest({ params: roleNameParamsSchema }),
    asyncHandler(rbacAdmin.deleteRole),
  );
  router.put(
    '/roles/:name/permissions',
    deps.authenticate,
    authorize(setRolePermissionsPolicy),
    validateRequest({ params: roleNameParamsSchema, body: setRolePermissionsBodySchema }),
    asyncHandler(rbacAdmin.setRolePermissions),
  );

  // --- RBAC mutations (permissions) ---
  router.post(
    '/permissions',
    deps.authenticate,
    authorize(createPermissionPolicy),
    validateRequest({ body: createPermissionBodySchema }),
    asyncHandler(rbacAdmin.createPermission),
  );
  router.patch(
    '/permissions/:name',
    deps.authenticate,
    authorize(updatePermissionPolicy),
    validateRequest({ params: permissionNameParamsSchema, body: updatePermissionBodySchema }),
    asyncHandler(rbacAdmin.updatePermission),
  );
  router.delete(
    '/permissions/:name',
    deps.authenticate,
    authorize(deletePermissionPolicy),
    validateRequest({ params: permissionNameParamsSchema }),
    asyncHandler(rbacAdmin.deletePermission),
  );

  // --- RBAC mutations (capabilities) ---
  router.post(
    '/capabilities',
    deps.authenticate,
    authorize(createCapabilityPolicy),
    validateRequest({ body: createCapabilityBodySchema }),
    asyncHandler(rbacAdmin.createCapability),
  );
  router.patch(
    '/capabilities/:id',
    deps.authenticate,
    authorize(updateCapabilityPolicy),
    validateRequest({ params: capabilityIdParamsSchema, body: updateCapabilityBodySchema }),
    asyncHandler(rbacAdmin.updateCapability),
  );
  router.delete(
    '/capabilities/:id',
    deps.authenticate,
    authorize(deleteCapabilityPolicy),
    validateRequest({ params: capabilityIdParamsSchema }),
    asyncHandler(rbacAdmin.deleteCapability),
  );

  // --- RBAC mutations (route + view bindings) ---
  router.patch(
    '/route-policies/:routeId',
    deps.authenticate,
    authorize(updateRoutePolicyPolicy),
    validateRequest({ params: routeIdParamsSchema, body: updateRoutePolicyBodySchema }),
    asyncHandler(rbacAdmin.updateRoutePolicy),
  );
  router.patch(
    '/view-permissions/:viewName/:mode',
    deps.authenticate,
    authorize(updateViewPermissionPolicy),
    validateRequest({ params: viewPermissionParamsSchema, body: updateViewPermissionBodySchema }),
    asyncHandler(rbacAdmin.updateViewPermission),
  );

  return router;
}
