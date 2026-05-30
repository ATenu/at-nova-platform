import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { SopService } from './sop.service';
import type {
  CreateSopBody,
  CreateSopVersionBody,
  ListSopsQuery,
  SopIdParams,
  UpdateSopBody,
} from './sop.schema';

export class SopController {
  constructor(private readonly service: SopService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListSopsQuery;
    const result = await this.service.listSops({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    });
    res.json(result);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as SopIdParams;
    res.json(await this.service.getSopById(id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    const body = req.body as CreateSopBody;
    res.status(201).json(await this.service.createSop(body, req.auth));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as SopIdParams;
    const body = req.body as UpdateSopBody;
    res.json(await this.service.updateSop(id, body));
  };

  addVersion = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    const { id } = req.params as unknown as SopIdParams;
    const body = req.body as CreateSopVersionBody;
    res.status(201).json(await this.service.addVersion(id, body.fullText, req.auth));
  };
}
