import type { Request, Response } from 'express';
import type { RbacService } from './rbac.service';

export class RbacController {
  constructor(private readonly service: RbacService) {}

  listRoles = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listRoles());
  };

  listPermissions = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listPermissions());
  };

  getMatrix = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getMatrix());
  };
}
