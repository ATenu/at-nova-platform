import type { CustomerIssue } from '@nova/database';
import { toIssueActionDto, type IssueActionDto } from '../actions/action.dto';
import { toSaleDto, type SaleDto } from '../sales/sale.dto';

export interface CustomerIssueDto {
  readonly id: string;
  readonly salesId: string;
  readonly sale?: SaleDto | undefined;
  readonly description: string;
  readonly dateRaised: string;
  readonly dateLastUpdate: string;
  readonly status: string;
  readonly issueActions?: readonly IssueActionDto[] | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toCustomerIssueDto(issue: CustomerIssue): CustomerIssueDto {
  return {
    id: issue.id,
    salesId: issue.salesId,
    sale: issue.sale ? toSaleDto(issue.sale) : undefined,
    description: issue.description,
    dateRaised: issue.dateRaised.toISOString(),
    dateLastUpdate: issue.dateLastUpdate.toISOString(),
    status: issue.status,
    issueActions: issue.issueActions ? issue.issueActions.map(toIssueActionDto) : undefined,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}
