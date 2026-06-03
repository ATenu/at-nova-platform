import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { RbacActor, RbacAdminService } from './rbac-admin.service';
import type {
  CapabilityIdParams,
  CreateCapabilityBody,
  CreatePermissionBody,
  CreateRoleBody,
  PermissionNameParams,
  RoleNameParams,
  RouteIdParams,
  SetRolePermissionsBody,
  UpdateCapabilityBody,
  UpdatePermissionBody,
  UpdateRoleBody,
  UpdateRoutePolicyBody,
  UpdateViewPermissionBody,
  ViewPermissionParams,
} from './rbac-admin.schema';

function actorOf(req: Request): RbacActor {
  if (!req.auth) {
    throw new UnauthenticatedError();
  }
  return { subject: req.auth.subject, userId: null };
}

/** Thin controllers for the audited RBAC mutation surface. */
export class RbacAdminController {
  constructor(private readonly service: RbacAdminService) {}

  createRole = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createRole(actorOf(req), req.body as CreateRoleBody));
  };

  updateRole = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as RoleNameParams;
    const body = req.body as UpdateRoleBody;
    res.json(await this.service.updateRole(actorOf(req), name, body.description));
  };

  deleteRole = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as RoleNameParams;
    res.json(await this.service.deleteRole(actorOf(req), name));
  };

  createPermission = async (req: Request, res: Response): Promise<void> => {
    res
      .status(201)
      .json(await this.service.createPermission(actorOf(req), req.body as CreatePermissionBody));
  };

  updatePermission = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as PermissionNameParams;
    const body = req.body as UpdatePermissionBody;
    res.json(await this.service.updatePermission(actorOf(req), name, body.description));
  };

  deletePermission = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as PermissionNameParams;
    res.json(await this.service.deletePermission(actorOf(req), name));
  };

  setRolePermissions = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as RoleNameParams;
    const body = req.body as SetRolePermissionsBody;
    res.json(await this.service.setRolePermissions(actorOf(req), name, body.permissions));
  };

  createCapability = async (req: Request, res: Response): Promise<void> => {
    res
      .status(201)
      .json(await this.service.createCapability(actorOf(req), req.body as CreateCapabilityBody));
  };

  updateCapability = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as CapabilityIdParams;
    res.json(await this.service.updateCapability(actorOf(req), id, req.body as UpdateCapabilityBody));
  };

  deleteCapability = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as CapabilityIdParams;
    res.json(await this.service.deleteCapability(actorOf(req), id));
  };

  updateRoutePolicy = async (req: Request, res: Response): Promise<void> => {
    const { routeId } = req.params as unknown as RouteIdParams;
    res.json(await this.service.updateRoutePolicy(actorOf(req), routeId, req.body as UpdateRoutePolicyBody));
  };

  updateViewPermission = async (req: Request, res: Response): Promise<void> => {
    const { viewName, mode } = req.params as unknown as ViewPermissionParams;
    const body = req.body as UpdateViewPermissionBody;
    res.json(await this.service.updateViewPermission(actorOf(req), viewName, mode, body.permissionName));
  };
}
