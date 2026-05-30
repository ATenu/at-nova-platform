import type { CustomerIssueStatus } from '@nova/database';
import { NotFoundError, ValidationError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import type { SaleRepository } from '../sales/sale.repository';
import { toCustomerIssueDto, type CustomerIssueDto } from './issue.dto';
import type { IssueListFilter, IssueRepository } from './issue.repository';

export interface CreateIssueInput {
  readonly salesId: string;
  readonly description: string;
  readonly dateRaised: string;
  readonly status: CustomerIssueStatus;
}

export interface UpdateIssueInput {
  readonly description?: string | undefined;
  readonly status?: CustomerIssueStatus | undefined;
  readonly dateLastUpdate?: string | undefined;
}

export class IssueService {
  constructor(
    private readonly issues: IssueRepository,
    private readonly sales: SaleRepository,
  ) {}

  async listIssues(filter: IssueListFilter): Promise<PaginatedResult<CustomerIssueDto>> {
    const { items, total } = await this.issues.findPaginated(filter);
    return buildPaginatedResult(items.map(toCustomerIssueDto), total, filter);
  }

  async getIssueById(id: string): Promise<CustomerIssueDto> {
    const issue = await this.issues.findById(id);
    if (!issue) {
      throw new NotFoundError('Customer issue not found.');
    }
    return toCustomerIssueDto(issue);
  }

  async createIssue(input: CreateIssueInput): Promise<CustomerIssueDto> {
    const sale = await this.sales.findById(input.salesId);
    if (!sale) {
      throw new ValidationError('The referenced sale does not exist.');
    }
    const id = await this.issues.create({
      salesId: input.salesId,
      description: input.description,
      dateRaised: new Date(input.dateRaised),
      status: input.status,
    });
    return this.getIssueById(id);
  }

  async updateIssue(id: string, input: UpdateIssueInput): Promise<CustomerIssueDto> {
    const existing = await this.issues.findById(id);
    if (!existing) {
      throw new NotFoundError('Customer issue not found.');
    }
    await this.issues.update(id, {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      dateLastUpdate: input.dateLastUpdate ? new Date(input.dateLastUpdate) : new Date(),
    });
    return this.getIssueById(id);
  }
}
