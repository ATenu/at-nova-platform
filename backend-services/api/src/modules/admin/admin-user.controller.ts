import type { Request, Response } from 'express';
import type { AdminUserService } from './admin-user.service';
import type {
  CreateUserBody,
  ListUsersQuery,
  SetRolesBody,
  UpdateUserBody,
  UserIdParams,
} from './admin.schema';

export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListUsersQuery;
    const result = await this.service.listUsers({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.role !== undefined ? { role: query.role } : {}),
    });
    res.json(result);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as UserIdParams;
    res.json(await this.service.getUser(id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CreateUserBody;
    res.status(201).json(await this.service.createUser(body));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as UserIdParams;
    const body = req.body as UpdateUserBody;
    res.json(await this.service.updateUser(id, body));
  };

  setRoles = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as UserIdParams;
    const body = req.body as SetRolesBody;
    res.json(await this.service.setUserRoles(id, body.roles));
  };

  syncKeycloak = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as UserIdParams;
    res.json(await this.service.syncUserToKeycloak(id));
  };
}
