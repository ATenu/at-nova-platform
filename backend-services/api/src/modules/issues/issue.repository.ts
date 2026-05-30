import { CustomerIssue, type CustomerIssueStatus } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface IssueListFilter extends PageRequest {
  readonly status?: CustomerIssueStatus;
  readonly customerId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface IssueListResult {
  readonly items: CustomerIssue[];
  readonly total: number;
}

export interface CreateIssueData {
  readonly salesId: string;
  readonly description: string;
  readonly dateRaised: Date;
  readonly status: CustomerIssueStatus;
}

export interface UpdateIssueData {
  readonly description?: string;
  readonly status?: CustomerIssueStatus;
  readonly dateLastUpdate: Date;
}

export class IssueRepository {
  private readonly issues: Repository<CustomerIssue>;

  constructor(dataSource: DataSource) {
    this.issues = dataSource.getRepository(CustomerIssue);
  }

  async findPaginated(filter: IssueListFilter): Promise<IssueListResult> {
    const query = this.issues
      .createQueryBuilder('issue')
      .leftJoinAndSelect('issue.sale', 'sale')
      .leftJoinAndSelect('sale.customer', 'customer');

    if (filter.status) {
      query.andWhere('issue.status = :status', { status: filter.status });
    }
    if (filter.customerId) {
      query.andWhere('sale.customer_id = :customerId', { customerId: filter.customerId });
    }
    if (filter.from) {
      query.andWhere('issue.date_raised >= :from', { from: filter.from });
    }
    if (filter.to) {
      query.andWhere('issue.date_raised <= :to', { to: filter.to });
    }

    query
      .orderBy('issue.dateRaised', 'DESC')
      .addOrderBy('issue.id', 'DESC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<CustomerIssue | null> {
    return this.issues.findOne({
      where: { id },
      relations: {
        sale: { customer: true },
        issueActions: { assignedOwner: true, updatedBy: true },
      },
      order: { issueActions: { createdDate: 'ASC' } },
    });
  }

  async create(data: CreateIssueData): Promise<string> {
    const issue = this.issues.create({
      salesId: data.salesId,
      description: data.description,
      dateRaised: data.dateRaised,
      dateLastUpdate: data.dateRaised,
      status: data.status,
    });
    const saved = await this.issues.save(issue);
    return saved.id;
  }

  async update(id: string, data: UpdateIssueData): Promise<void> {
    const patch: Partial<CustomerIssue> = { dateLastUpdate: data.dateLastUpdate };
    if (data.description !== undefined) {
      patch.description = data.description;
    }
    if (data.status !== undefined) {
      patch.status = data.status;
    }
    await this.issues.update({ id }, patch);
  }
}
