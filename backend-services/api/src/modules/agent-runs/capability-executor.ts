import { z } from 'zod';
import { CustomerIssueStatus, IssueActionStatus } from '@nova/database';
import { ValidationError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import type { AgentToolLink } from './agent-links';
import type { CustomerService } from '../customers/customer.service';
import type { SaleService } from '../sales/sale.service';
import type { IssueService } from '../issues/issue.service';
import type { ActionService } from '../actions/action.service';
import type { SopService } from '../sops/sop.service';

/**
 * Executes a single capability (MCP tool) by delegating to the SAME
 * permission-gated business service the equivalent REST route already uses
 * (plan section 5.5: "implement MCP tools as thin callers of those existing,
 * permission-gated API operations"). This guarantees the authorization is the
 * API's own authorization — reused, never re-implemented — and that the
 * execution plane never touches the business `nova` database directly.
 *
 * The capability -> permission gate has already been re-enforced against the
 * entitlement snapshot by the tool-gateway service before this runs. Inputs are
 * validated here because the worker is an untrusted boundary.
 */
export interface ToolCallResult {
  readonly capabilityId: string;
  readonly summary: string;
  readonly data: unknown;
  readonly links: readonly AgentToolLink[];
}

export interface CapabilityServices {
  readonly customers: CustomerService;
  readonly sales: SaleService;
  readonly issues: IssueService;
  readonly actions: ActionService;
  readonly sops: SopService;
}

const customerIdInput = z.object({ customerId: z.string().uuid() });
const actionIdInput = z.object({ actionId: z.string().uuid() });
const sopReadInput = z.object({ sopId: z.string().uuid().optional() });
const issuesCreateInput = z.object({
  salesId: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  dateRaised: z.string().datetime().optional(),
});
const salesCreateInput = z.object({
  customerId: z.string().uuid(),
  date: z.string().datetime(),
  discountApplied: z.string().default('0'),
  paymentReceived: z.boolean().default(false),
  dateOfPayment: z.string().datetime().nullable().default(null),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1),
});

const LIST_PAGE = { page: 1, pageSize: 50 } as const;

export class CapabilityExecutor {
  constructor(private readonly services: CapabilityServices) {}

  async execute(
    capabilityId: string,
    rawInput: unknown,
    auth: AuthContext,
  ): Promise<ToolCallResult> {
    switch (capabilityId) {
      case 'sales.report.customer':
        return this.salesReport(rawInput);
      case 'issues.list.pendingForCustomer':
        return this.pendingIssues(rawInput);
      case 'actions.next':
        return this.nextAction();
      case 'actions.markCompleted':
        return this.markActionCompleted(rawInput, auth);
      case 'sales.create':
        return this.createSale(rawInput);
      case 'issues.create':
        return this.createIssue(rawInput);
      case 'sop.read':
        return this.readSop(rawInput);
      default:
        // Default deny: a capability with no executor is unreachable.
        throw new ValidationError(`Capability "${capabilityId}" is not executable.`);
    }
  }

  private parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const result = schema.safeParse(input ?? {});
    if (!result.success) {
      throw new ValidationError('Invalid capability input.');
    }
    return result.data;
  }

  private async salesReport(input: unknown): Promise<ToolCallResult> {
    const { customerId } = this.parse(customerIdInput, input);
    const customer = await this.services.customers.getCustomerById(customerId);
    const sales = await this.services.sales.listSales({ ...LIST_PAGE, customerId });
    return {
      capabilityId: 'sales.report.customer',
      summary: `${customer.fullName} has ${sales.total} sale(s) on record.`,
      data: { customer, sales: sales.items, totalSales: sales.total },
      links: [{ label: `Open ${customer.fullName}`, href: `nova://customer/${customerId}`, type: 'customer' }],
    };
  }

  private async pendingIssues(input: unknown): Promise<ToolCallResult> {
    const { customerId } = this.parse(customerIdInput, input);
    const issues = await this.services.issues.listIssues({
      ...LIST_PAGE,
      customerId,
      status: CustomerIssueStatus.IN_ASSISTANCE,
    });
    return {
      capabilityId: 'issues.list.pendingForCustomer',
      summary: `${issues.total} pending issue(s) for this customer.`,
      data: { issues: issues.items, total: issues.total },
      links: issues.items.slice(0, 5).map((issue) => ({
        label: `Open issue ${issue.id.slice(0, 8)}`,
        href: `nova://issue/${issue.id}`,
        type: 'issue' as const,
      })),
    };
  }

  private async nextAction(): Promise<ToolCallResult> {
    const pending = await this.services.actions.listActions({
      page: 1,
      pageSize: 1,
      status: IssueActionStatus.PENDING,
    });
    const next = pending.items[0];
    return {
      capabilityId: 'actions.next',
      summary: next ? `Next action: ${next.title}` : 'No pending actions.',
      data: { nextAction: next ?? null, pendingTotal: pending.total },
      links: next ? [{ label: 'Open action', href: `nova://action/${next.id}`, type: 'action' }] : [],
    };
  }

  private async markActionCompleted(input: unknown, auth: AuthContext): Promise<ToolCallResult> {
    const { actionId } = this.parse(actionIdInput, input);
    const action = await this.services.actions.updateAction(
      actionId,
      { status: IssueActionStatus.COMPLETED },
      auth,
    );
    return {
      capabilityId: 'actions.markCompleted',
      summary: `Marked action "${action.title}" as completed.`,
      data: { action },
      links: [{ label: 'Open action', href: `nova://action/${action.id}`, type: 'action' }],
    };
  }

  private async createSale(input: unknown): Promise<ToolCallResult> {
    const data = this.parse(salesCreateInput, input);
    const sale = await this.services.sales.createSale(data);
    return {
      capabilityId: 'sales.create',
      summary: `Created sale ${sale.id.slice(0, 8)} for ${sale.totalAmountReceipt}.`,
      data: { sale },
      links: [{ label: 'Open sale', href: `nova://sale/${sale.id}`, type: 'sale' }],
    };
  }

  private async createIssue(input: unknown): Promise<ToolCallResult> {
    const data = this.parse(issuesCreateInput, input);
    const issue = await this.services.issues.createIssue({
      salesId: data.salesId,
      description: data.description,
      dateRaised: data.dateRaised ?? new Date().toISOString(),
      status: CustomerIssueStatus.IN_ASSISTANCE,
    });
    return {
      capabilityId: 'issues.create',
      summary: `Opened issue ${issue.id.slice(0, 8)}.`,
      data: { issue },
      links: [{ label: 'Open issue', href: `nova://issue/${issue.id}`, type: 'issue' }],
    };
  }

  private async readSop(input: unknown): Promise<ToolCallResult> {
    const { sopId } = this.parse(sopReadInput, input);
    if (sopId) {
      const sop = await this.services.sops.getSopById(sopId);
      return {
        capabilityId: 'sop.read',
        summary: `SOP "${sop.name}".`,
        data: { sop },
        links: [{ label: `Open ${sop.name}`, href: `nova://sop/${sop.id}`, type: 'sop' }],
      };
    }
    const sops = await this.services.sops.listSops({ page: 1, pageSize: 20 });
    return {
      capabilityId: 'sop.read',
      summary: `${sops.total} SOP(s) available.`,
      data: { sops: sops.items, total: sops.total },
      links: [],
    };
  }
}
