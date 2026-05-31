import { z } from 'zod';
import { CustomerIssueStatus, IssueActionStatus } from '@nova/database';
import { ValidationError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import type { AgentToolLink } from './agent-links';
import type { CustomerService } from '../customers/customer.service';
import type { ProductService } from '../products/product.service';
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
  readonly products: ProductService;
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

// --- Resolver / read inputs ------------------------------------------------
const customersSearchInput = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  active: z.boolean().optional(),
});
const productsSearchInput = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(255).optional(),
  inCatalog: z.boolean().optional(),
});
const productIdInput = z.object({ productId: z.string().uuid() });
const salesListInput = z.object({
  customerId: z.string().uuid().optional(),
  paymentReceived: z.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const saleIdInput = z.object({ saleId: z.string().uuid() });
const issuesListInput = z.object({
  status: z.nativeEnum(CustomerIssueStatus).optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const issueIdInput = z.object({ issueId: z.string().uuid() });
const actionsListInput = z.object({
  status: z.nativeEnum(IssueActionStatus).optional(),
  assignedOwnerId: z.string().uuid().optional(),
  issueId: z.string().uuid().optional(),
});

// --- Write inputs ----------------------------------------------------------
const actionAddCommentInput = z.object({
  actionId: z.string().uuid(),
  comment: z.string().trim().min(1).max(2000),
});
const actionUpdateInput = z
  .object({
    actionId: z.string().uuid(),
    status: z.nativeEnum(IssueActionStatus).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    assignedOwnerId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.description !== undefined ||
      value.assignedOwnerId !== undefined,
    { message: 'Provide at least a status, description, or assignedOwnerId to update.' },
  );
const issueUpdateInput = z
  .object({
    issueId: z.string().uuid(),
    description: z.string().trim().min(1).max(2000).optional(),
    status: z.nativeEnum(CustomerIssueStatus).optional(),
  })
  .refine((value) => value.description !== undefined || value.status !== undefined, {
    message: 'Provide at least a description or status to update.',
  });
const sopCreateInput = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1),
  fullText: z.string().trim().min(1),
  active: z.boolean().default(true),
});
const sopUpdateInput = z
  .object({
    sopId: z.string().uuid(),
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.active !== undefined,
    { message: 'Provide at least a name, description, or active flag to update.' },
  );
const sopAddVersionInput = z.object({
  sopId: z.string().uuid(),
  fullText: z.string().trim().min(1),
});

const LIST_PAGE = { page: 1, pageSize: 50 } as const;
const RESOLVER_PREVIEW = 5;

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
      case 'sales.products.forCustomer':
        return this.customerProducts(rawInput);
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
      // --- Conversational resolver + detail reads --------------------------
      case 'customers.search':
        return this.searchCustomers(rawInput);
      case 'customers.get':
        return this.getCustomer(rawInput);
      case 'products.search':
        return this.searchProducts(rawInput);
      case 'products.get':
        return this.getProduct(rawInput);
      case 'sales.list':
        return this.listSales(rawInput);
      case 'sales.get':
        return this.getSale(rawInput);
      case 'issues.list':
        return this.listIssues(rawInput);
      case 'issues.get':
        return this.getIssue(rawInput);
      case 'actions.list':
        return this.listActions(rawInput);
      case 'actions.get':
        return this.getAction(rawInput);
      // --- Domain writes ----------------------------------------------------
      case 'actions.addComment':
        return this.addActionComment(rawInput, auth);
      case 'actions.update':
        return this.updateAction(rawInput, auth);
      case 'issues.update':
        return this.updateIssue(rawInput);
      case 'sop.create':
        return this.createSop(rawInput, auth);
      case 'sop.update':
        return this.updateSop(rawInput);
      case 'sop.addVersion':
        return this.addSopVersion(rawInput, auth);
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

  private async customerProducts(input: unknown): Promise<ToolCallResult> {
    const { customerId } = this.parse(customerIdInput, input);
    // Resource-scoped: resolve (and authorize existence of) the customer first,
    // mirroring sales.report.customer, then aggregate their purchased products.
    const customer = await this.services.customers.getCustomerById(customerId);
    const result = await this.services.sales.productsForCustomer(customerId);
    const preview = result.products
      .slice(0, RESOLVER_PREVIEW)
      .map((product) => `${product.name} x${product.totalQuantity}`)
      .join('; ');
    const summary =
      result.totalProducts === 0
        ? `${customer.fullName} has not purchased any products.`
        : `${customer.fullName} purchased ${result.totalProducts} distinct product(s)${preview ? `: ${preview}` : ''}.`;
    return {
      capabilityId: 'sales.products.forCustomer',
      summary,
      data: { customer, ...result },
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

  // --- Conversational resolver + detail reads --------------------------------

  private async searchCustomers(input: unknown): Promise<ToolCallResult> {
    const { search, active } = this.parse(customersSearchInput, input);
    const result = await this.services.customers.listCustomers({
      ...LIST_PAGE,
      ...(search !== undefined ? { search } : {}),
      ...(active !== undefined ? { active } : {}),
    });
    const matches = result.items.map((customer) => ({
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      active: customer.active,
    }));
    return {
      capabilityId: 'customers.search',
      summary: this.matchSummary(
        'customer',
        result.total,
        search,
        matches.map((m) => `${m.fullName} (${m.id})`),
      ),
      data: { customers: matches, total: result.total },
      links: matches.slice(0, RESOLVER_PREVIEW).map((m) => ({
        label: `Open ${m.fullName}`,
        href: `nova://customer/${m.id}`,
        type: 'customer' as const,
      })),
    };
  }

  private async getCustomer(input: unknown): Promise<ToolCallResult> {
    const { customerId } = this.parse(customerIdInput, input);
    const customer = await this.services.customers.getCustomerById(customerId);
    return {
      capabilityId: 'customers.get',
      summary: `${customer.fullName} <${customer.email}>${customer.active ? '' : ' (inactive)'}.`,
      data: { customer },
      links: [
        { label: `Open ${customer.fullName}`, href: `nova://customer/${customerId}`, type: 'customer' },
      ],
    };
  }

  private async searchProducts(input: unknown): Promise<ToolCallResult> {
    const { search, category, inCatalog } = this.parse(productsSearchInput, input);
    const result = await this.services.products.listProducts({
      ...LIST_PAGE,
      ...(search !== undefined ? { search } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(inCatalog !== undefined ? { inCatalog } : {}),
    });
    const matches = result.items.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      inCatalog: product.inCatalog,
    }));
    return {
      capabilityId: 'products.search',
      summary: this.matchSummary(
        'product',
        result.total,
        search,
        matches.map((m) => `${m.name} (${m.id})`),
      ),
      data: { products: matches, total: result.total },
      links: [],
    };
  }

  private async getProduct(input: unknown): Promise<ToolCallResult> {
    const { productId } = this.parse(productIdInput, input);
    const product = await this.services.products.getProductById(productId);
    return {
      capabilityId: 'products.get',
      summary: `${product.name} — ${product.category}, ${product.price}${product.inCatalog ? '' : ' (not in catalog)'}.`,
      data: { product },
      links: [],
    };
  }

  private async listSales(input: unknown): Promise<ToolCallResult> {
    const { customerId, paymentReceived, from, to } = this.parse(salesListInput, input);
    const result = await this.services.sales.listSales({
      ...LIST_PAGE,
      ...(customerId !== undefined ? { customerId } : {}),
      ...(paymentReceived !== undefined ? { paymentReceived } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    const matches = result.items.map((sale) => ({
      id: sale.id,
      customerId: sale.customerId,
      date: sale.date,
      totalAmountReceipt: sale.totalAmountReceipt,
      paymentReceived: sale.paymentReceived,
    }));
    return {
      capabilityId: 'sales.list',
      summary: `${result.total} sale(s) match.`,
      data: { sales: matches, total: result.total },
      links: matches.slice(0, RESOLVER_PREVIEW).map((m) => ({
        label: `Open sale ${m.id.slice(0, 8)}`,
        href: `nova://sale/${m.id}`,
        type: 'sale' as const,
      })),
    };
  }

  private async getSale(input: unknown): Promise<ToolCallResult> {
    const { saleId } = this.parse(saleIdInput, input);
    const sale = await this.services.sales.getSaleById(saleId);
    return {
      capabilityId: 'sales.get',
      summary: `Sale ${sale.id.slice(0, 8)} — ${sale.totalAmountReceipt}, ${sale.paymentReceived ? 'paid' : 'unpaid'}.`,
      data: { sale },
      links: [{ label: `Open sale ${sale.id.slice(0, 8)}`, href: `nova://sale/${sale.id}`, type: 'sale' }],
    };
  }

  private async listIssues(input: unknown): Promise<ToolCallResult> {
    const { status, customerId, from, to } = this.parse(issuesListInput, input);
    const result = await this.services.issues.listIssues({
      ...LIST_PAGE,
      ...(status !== undefined ? { status } : {}),
      ...(customerId !== undefined ? { customerId } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    const matches = result.items.map((issue) => ({
      id: issue.id,
      salesId: issue.salesId,
      status: issue.status,
      dateRaised: issue.dateRaised,
    }));
    return {
      capabilityId: 'issues.list',
      summary: `${result.total} issue(s) match.`,
      data: { issues: matches, total: result.total },
      links: matches.slice(0, RESOLVER_PREVIEW).map((m) => ({
        label: `Open issue ${m.id.slice(0, 8)}`,
        href: `nova://issue/${m.id}`,
        type: 'issue' as const,
      })),
    };
  }

  private async getIssue(input: unknown): Promise<ToolCallResult> {
    const { issueId } = this.parse(issueIdInput, input);
    const issue = await this.services.issues.getIssueById(issueId);
    return {
      capabilityId: 'issues.get',
      summary: `Issue ${issue.id.slice(0, 8)} — status ${issue.status}.`,
      data: { issue },
      links: [{ label: `Open issue ${issue.id.slice(0, 8)}`, href: `nova://issue/${issue.id}`, type: 'issue' }],
    };
  }

  private async listActions(input: unknown): Promise<ToolCallResult> {
    const { status, assignedOwnerId, issueId } = this.parse(actionsListInput, input);
    const result = await this.services.actions.listActions({
      ...LIST_PAGE,
      ...(status !== undefined ? { status } : {}),
      ...(assignedOwnerId !== undefined ? { assignedOwnerId } : {}),
      ...(issueId !== undefined ? { issueId } : {}),
    });
    const matches = result.items.map((action) => ({
      id: action.id,
      title: action.title,
      status: action.status,
      issueId: action.issueId,
    }));
    return {
      capabilityId: 'actions.list',
      summary: this.matchSummary(
        'action',
        result.total,
        undefined,
        matches.map((m) => `${m.title} (${m.id})`),
      ),
      data: { actions: matches, total: result.total },
      links: matches.slice(0, RESOLVER_PREVIEW).map((m) => ({
        label: `Open action ${m.id.slice(0, 8)}`,
        href: `nova://action/${m.id}`,
        type: 'action' as const,
      })),
    };
  }

  private async getAction(input: unknown): Promise<ToolCallResult> {
    const { actionId } = this.parse(actionIdInput, input);
    const action = await this.services.actions.getActionById(actionId);
    return {
      capabilityId: 'actions.get',
      summary: `Action "${action.title}" — status ${action.status}.`,
      data: { action },
      links: [{ label: 'Open action', href: `nova://action/${action.id}`, type: 'action' }],
    };
  }

  // --- Domain writes ---------------------------------------------------------

  private async addActionComment(input: unknown, auth: AuthContext): Promise<ToolCallResult> {
    const { actionId, comment } = this.parse(actionAddCommentInput, input);
    const created = await this.services.actions.addComment(
      actionId,
      { comment, datetime: new Date().toISOString() },
      auth,
    );
    return {
      capabilityId: 'actions.addComment',
      summary: `Added a comment to action ${actionId.slice(0, 8)}.`,
      data: { comment: created },
      links: [{ label: 'Open action', href: `nova://action/${actionId}`, type: 'action' }],
    };
  }

  private async updateAction(input: unknown, auth: AuthContext): Promise<ToolCallResult> {
    const { actionId, status, description, assignedOwnerId } = this.parse(actionUpdateInput, input);
    const action = await this.services.actions.updateAction(
      actionId,
      {
        ...(status !== undefined ? { status } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(assignedOwnerId !== undefined ? { assignedOwnerId } : {}),
      },
      auth,
    );
    return {
      capabilityId: 'actions.update',
      summary: `Updated action "${action.title}" (status ${action.status}).`,
      data: { action },
      links: [{ label: 'Open action', href: `nova://action/${action.id}`, type: 'action' }],
    };
  }

  private async updateIssue(input: unknown): Promise<ToolCallResult> {
    const { issueId, description, status } = this.parse(issueUpdateInput, input);
    const issue = await this.services.issues.updateIssue(issueId, {
      ...(description !== undefined ? { description } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return {
      capabilityId: 'issues.update',
      summary: `Updated issue ${issue.id.slice(0, 8)} (status ${issue.status}).`,
      data: { issue },
      links: [{ label: `Open issue ${issue.id.slice(0, 8)}`, href: `nova://issue/${issue.id}`, type: 'issue' }],
    };
  }

  private async createSop(input: unknown, auth: AuthContext): Promise<ToolCallResult> {
    const { name, description, fullText, active } = this.parse(sopCreateInput, input);
    const sop = await this.services.sops.createSop({ name, description, fullText, active }, auth);
    return {
      capabilityId: 'sop.create',
      summary: `Created SOP "${sop.name}".`,
      data: { sop },
      links: [{ label: `Open ${sop.name}`, href: `nova://sop/${sop.id}`, type: 'sop' }],
    };
  }

  private async updateSop(input: unknown): Promise<ToolCallResult> {
    const { sopId, name, description, active } = this.parse(sopUpdateInput, input);
    const sop = await this.services.sops.updateSop(sopId, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(active !== undefined ? { active } : {}),
    });
    return {
      capabilityId: 'sop.update',
      summary: `Updated SOP "${sop.name}".`,
      data: { sop },
      links: [{ label: `Open ${sop.name}`, href: `nova://sop/${sop.id}`, type: 'sop' }],
    };
  }

  private async addSopVersion(input: unknown, auth: AuthContext): Promise<ToolCallResult> {
    const { sopId, fullText } = this.parse(sopAddVersionInput, input);
    const detail = await this.services.sops.addVersion(sopId, fullText, auth);
    return {
      capabilityId: 'sop.addVersion',
      summary: `Added version ${detail.version} to SOP ${sopId.slice(0, 8)}.`,
      data: { detail },
      links: [{ label: 'Open SOP', href: `nova://sop/${sopId}`, type: 'sop' }],
    };
  }

  /** Compact, id-bearing summary so the reasoner can resolve a name to a UUID. */
  private matchSummary(
    noun: string,
    total: number,
    search: string | undefined,
    previews: readonly string[],
  ): string {
    const head = `${total} ${noun}(s) match${search ? ` "${search}"` : ''}.`;
    if (previews.length === 0) {
      return head;
    }
    return `${head} Top: ${previews.slice(0, RESOLVER_PREVIEW).join('; ')}.`;
  }
}
