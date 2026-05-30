import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { ActionService } from './action.service';
import type { ActionIdParams, AddCommentBody, ListActionsQuery, UpdateActionBody } from './action.schema';

export class ActionController {
  constructor(private readonly service: ActionService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListActionsQuery;
    const result = await this.service.listActions({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.assignedOwnerId !== undefined ? { assignedOwnerId: query.assignedOwnerId } : {}),
      ...(query.issueId !== undefined ? { issueId: query.issueId } : {}),
    });
    res.json(result);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    const { id } = req.params as unknown as ActionIdParams;
    const body = req.body as UpdateActionBody;
    res.json(await this.service.updateAction(id, body, req.auth));
  };

  addComment = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    const { id } = req.params as unknown as ActionIdParams;
    const body = req.body as AddCommentBody;
    res.status(201).json(await this.service.addComment(id, body, req.auth));
  };
}
