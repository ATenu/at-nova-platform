import type { Request, Response } from 'express';
import type { IssueService } from './issue.service';
import type {
  CreateIssueBody,
  IssueIdParams,
  ListIssuesQuery,
  UpdateIssueBody,
} from './issue.schema';

export class IssueController {
  constructor(private readonly service: IssueService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListIssuesQuery;
    const result = await this.service.listIssues({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
    res.json(result);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as IssueIdParams;
    res.json(await this.service.getIssueById(id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CreateIssueBody;
    const issue = await this.service.createIssue(body);
    res.status(201).json(issue);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as IssueIdParams;
    const body = req.body as UpdateIssueBody;
    res.json(await this.service.updateIssue(id, body));
  };
}
