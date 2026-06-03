/**
 * In-memory fixtures for the dev mock API. Mirrors the backend seed so deep
 * links and IDs line up (e.g. `nova://issues/issue-philip-gamma-weak-suction`).
 * Dev-only — never bundled into production (mocks are gated by env.useMocks).
 */
import type {
  ActionCommentDto,
  AdminUserDto,
  ConversationDto,
  CustomerDto,
  CustomerIssueDto,
  IssueActionDto,
  PermissionDto,
  ProductDto,
  RoleDto,
  SaleDto,
  SopDto,
  UserDto,
} from '@/api/types';

/** Strip top-level `readonly` so the in-memory mock stores can be mutated. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const now = '2026-05-30T12:00:00.000Z';

/**
 * Mock RBAC seed mirroring the backend authoritative catalog. The dev mock
 * treats this as a single mutable registry so the editable admin UI and the
 * `/rbac/registry` + `/auth/me` endpoints stay consistent in dev mode.
 */
export const rbacStore: {
  revision: number;
  roles: Mutable<RoleDto>[];
  permissions: Mutable<PermissionDto>[];
  rolePermissions: Record<string, string[]>;
} = {
  revision: 1,
  roles: [
    { name: 'sales-user', description: 'Sales team', isSystem: true },
    { name: 'support-operations-user', description: 'Operations and maintenance team', isSystem: true },
    { name: 'admin', description: 'System administrator', isSystem: true },
    { name: 'customer-support', description: 'Customer support team', isSystem: true },
    { name: 'ops-compliance', description: 'Compliance team', isSystem: true },
  ],
  permissions: [
    'read-customers', 'write-customers', 'create-issues', 'read-issues', 'write-issues',
    'read-sales', 'write-sales', 'read-permissions', 'write-permissions', 'read-actions',
    'write-actions', 'read-sop', 'write-sop', 'read-users', 'write-users',
    'create-agent-run', 'read-agent-run', 'cancel-agent-run',
  ].map((name) => ({ name, description: null, isSystem: true })),
  rolePermissions: {
    'sales-user': [
      'read-customers', 'write-customers', 'read-issues', 'read-sales', 'write-sales',
      'read-actions', 'read-sop', 'create-agent-run', 'read-agent-run', 'cancel-agent-run',
    ],
    'support-operations-user': [
      'read-customers', 'write-customers', 'read-issues', 'write-issues', 'read-sales',
      'read-actions', 'write-actions', 'read-sop', 'create-agent-run', 'read-agent-run', 'cancel-agent-run',
    ],
    admin: [
      'read-customers', 'write-customers', 'create-issues', 'read-issues', 'write-issues',
      'read-sales', 'write-sales', 'read-permissions', 'write-permissions', 'read-actions',
      'write-actions', 'read-sop', 'write-sop', 'read-users', 'write-users',
      'create-agent-run', 'read-agent-run', 'cancel-agent-run',
    ],
    'ops-compliance': ['read-sop', 'write-sop', 'create-agent-run', 'read-agent-run', 'cancel-agent-run'],
    'customer-support': [
      'read-customers', 'create-issues', 'read-issues', 'write-issues', 'read-sales',
      'read-actions', 'write-actions', 'create-agent-run', 'read-agent-run', 'cancel-agent-run',
    ],
  },
};

export function permissionsFor(roles: readonly string[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    for (const permission of rbacStore.rolePermissions[role] ?? []) {
      set.add(permission);
    }
  }
  return [...set];
}

interface SeedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  description: string;
  role: string;
}

const seedUsers: readonly SeedUser[] = [
  { id: 'user-admin', email: 'admin@test.com', firstName: 'admin', lastName: 'admin', description: 'super admin users and system admin', role: 'admin' },
  { id: 'user-sales', email: 'salesman@test.com', firstName: 'sales', lastName: 'man', description: 'sales team', role: 'sales-user' },
  { id: 'user-ops', email: 'opsman@test.com', firstName: 'ope', lastName: 'man', description: 'operations and maintenance team', role: 'support-operations-user' },
  { id: 'user-compliance', email: 'compliance@test.com', firstName: 'compliance', lastName: 'ops', description: 'compliance team', role: 'ops-compliance' },
  { id: 'user-crm', email: 'crm@test.com', firstName: 'customer', lastName: 'support', description: 'customer support team', role: 'customer-support' },
];

export const usersStore: Mutable<AdminUserDto>[] = seedUsers.map((user) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  middleName: null,
  description: user.description,
  roles: [user.role],
  permissions: permissionsFor([user.role]),
  active: true,
  createdAt: now,
  updatedAt: now,
  keycloak: {
    exists: true,
    enabled: true,
    syncedRoles: [user.role],
    syncStatus: 'synced',
    lastSyncError: null,
  },
}));

function userRef(id: string): UserDto {
  const user = usersStore.find((u) => u.id === id)!;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName ?? null,
    description: user.description ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function findUserByEmail(email: string): AdminUserDto | undefined {
  return usersStore.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export const customersStore: Mutable<CustomerDto>[] = [
  { id: 'cust-agostino', email: 'agostino.tenuta@mc.com', fullName: 'Agostino Tenuta', firstName: 'Agostino', lastName: 'Tenuta', age: 31, active: true, salesCount: 2, issuesCount: 1, createdAt: now, updatedAt: now },
  { id: 'cust-mario', email: 'mario@ar.com', fullName: 'Mario Rossi', firstName: 'Mario', lastName: 'Rossi', age: 45, active: true, salesCount: 1, issuesCount: 1, createdAt: now, updatedAt: now },
  { id: 'cust-philip', email: 'philip.sanders@rs.com', fullName: 'Philip Sanders', firstName: 'Philip', lastName: 'Sanders', age: 50, active: true, salesCount: 1, issuesCount: 1, createdAt: now, updatedAt: now },
];

export const productsStore: Mutable<ProductDto>[] = [
  { id: 'alpha', name: 'Alpha', description: 'Alpha is an industrial metal brush to clean up material waste from production lines', category: 'industrial-merchandising', price: '200.00', inCatalog: true, createdAt: now, updatedAt: now },
  { id: 'beta', name: 'Beta', description: 'Beta is a top gamma cleaning machine for private houses', category: 'house-merchandising', price: '150.00', inCatalog: true, createdAt: now, updatedAt: now },
  { id: 'gamma', name: 'Gamma', description: 'Gamma is an economy vacuum cleaner for private houses', category: 'house-merchandising', price: '50.00', inCatalog: true, createdAt: now, updatedAt: now },
  { id: 'delta', name: 'Delta', description: 'Delta consists of a pack of 5 vacuum bags, compatible with both Beta and Gamma', category: 'house-merchandising', price: '15.00', inCatalog: true, createdAt: now, updatedAt: now },
];

function product(id: string): ProductDto {
  return productsStore.find((p) => p.id === id)!;
}
function customer(id: string): CustomerDto {
  return customersStore.find((c) => c.id === id)!;
}

export const salesStore: Mutable<SaleDto>[] = [
  {
    id: 'sale-agostino-alpha-delta-2026-05-20',
    customerId: 'cust-agostino',
    customer: customer('cust-agostino'),
    discountApplied: '10.00',
    date: '2026-05-20T10:30:00.000Z',
    totalAmountReceipt: '207.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-20T10:35:00.000Z',
    productsSold: [
      { saleId: 'sale-agostino-alpha-delta-2026-05-20', productId: 'alpha', quantity: 1, product: product('alpha') },
      { saleId: 'sale-agostino-alpha-delta-2026-05-20', productId: 'delta', quantity: 2, product: product('delta') },
    ],
    issuesCount: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sale-mario-beta-gamma-2026-05-22',
    customerId: 'cust-mario',
    customer: customer('cust-mario'),
    discountApplied: '0.00',
    date: '2026-05-22T14:15:00.000Z',
    totalAmountReceipt: '200.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-22T14:20:00.000Z',
    productsSold: [
      { saleId: 'sale-mario-beta-gamma-2026-05-22', productId: 'beta', quantity: 1, product: product('beta') },
      { saleId: 'sale-mario-beta-gamma-2026-05-22', productId: 'gamma', quantity: 1, product: product('gamma') },
    ],
    issuesCount: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sale-philip-gamma-delta-2026-05-26',
    customerId: 'cust-philip',
    customer: customer('cust-philip'),
    discountApplied: '5.00',
    date: '2026-05-26T16:45:00.000Z',
    totalAmountReceipt: '137.75',
    paymentReceived: false,
    dateOfPayment: null,
    productsSold: [
      { saleId: 'sale-philip-gamma-delta-2026-05-26', productId: 'gamma', quantity: 2, product: product('gamma') },
      { saleId: 'sale-philip-gamma-delta-2026-05-26', productId: 'delta', quantity: 3, product: product('delta') },
    ],
    issuesCount: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sale-agostino-beta-2026-05-27',
    customerId: 'cust-agostino',
    customer: customer('cust-agostino'),
    discountApplied: '0.00',
    date: '2026-05-27T11:10:00.000Z',
    totalAmountReceipt: '150.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-27T11:12:00.000Z',
    productsSold: [
      { saleId: 'sale-agostino-beta-2026-05-27', productId: 'beta', quantity: 1, product: product('beta') },
    ],
    issuesCount: 0,
    createdAt: now,
    updatedAt: now,
  },
];

function comment(
  id: string,
  actionId: string,
  userId: string,
  text: string,
  datetime: string,
): ActionCommentDto {
  return {
    id,
    issueActionId: actionId,
    userId,
    user: userRef(userId),
    comment: text,
    datetime,
    createdAt: datetime,
    updatedAt: datetime,
  };
}

export const actionsStore: Mutable<IssueActionDto>[] = [
  {
    id: 'action-mario-validate-replacement',
    issueId: 'issue-mario-beta-cracked-panel',
    title: 'Validate replacement request',
    description: 'Check original sale, product, purchase date, and reported defect evidence.',
    status: 'completed',
    assignedOwnerId: 'user-crm',
    assignedOwner: userRef('user-crm'),
    updatedById: 'user-crm',
    updatedBy: userRef('user-crm'),
    updatedAI: false,
    createdDate: '2026-05-23T09:10:00.000Z',
    dependencies: [],
    comments: [comment('c1', 'action-mario-validate-replacement', 'user-crm', 'Purchase date and product details validated. Within the 1-year replacement window.', '2026-05-23T09:45:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-mario-ship-replacement',
    issueId: 'issue-mario-beta-cracked-panel',
    title: 'Ship replacement Beta unit',
    description: 'Operations to create zero-value replacement order and prepare shipment.',
    status: 'completed',
    assignedOwnerId: 'user-ops',
    assignedOwner: userRef('user-ops'),
    updatedById: 'user-ops',
    updatedBy: userRef('user-ops'),
    updatedAI: false,
    createdDate: '2026-05-23T11:00:00.000Z',
    dependencies: [{ actionId: 'action-mario-ship-replacement', dependsOnActionId: 'action-mario-validate-replacement' }],
    comments: [comment('c2', 'action-mario-ship-replacement', 'user-ops', 'Replacement Beta unit prepared and handed to logistics.', '2026-05-24T11:20:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-mario-notify-customer',
    issueId: 'issue-mario-beta-cracked-panel',
    title: 'Notify customer of completed replacement',
    description: 'Customer support to confirm shipment and close the customer issue.',
    status: 'completed',
    assignedOwnerId: 'user-crm',
    assignedOwner: userRef('user-crm'),
    updatedById: 'user-crm',
    updatedBy: userRef('user-crm'),
    updatedAI: true,
    createdDate: '2026-05-24T16:45:00.000Z',
    dependencies: [{ actionId: 'action-mario-notify-customer', dependsOnActionId: 'action-mario-ship-replacement' }],
    comments: [comment('c3', 'action-mario-notify-customer', 'user-crm', 'Customer notified. Issue closed successfully.', '2026-05-24T17:30:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-philip-collect-evidence',
    issueId: 'issue-philip-gamma-weak-suction',
    title: 'Collect customer evidence',
    description: 'Ask customer to provide photos, short video, and usage description for the Gamma vacuum cleaner.',
    status: 'completed',
    assignedOwnerId: 'user-crm',
    assignedOwner: userRef('user-crm'),
    updatedById: 'user-crm',
    updatedBy: userRef('user-crm'),
    updatedAI: false,
    createdDate: '2026-05-27T09:00:00.000Z',
    dependencies: [],
    comments: [comment('c4', 'action-philip-collect-evidence', 'user-crm', 'Customer sent a short video showing weak suction.', '2026-05-27T15:25:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-philip-assess-warranty',
    issueId: 'issue-philip-gamma-weak-suction',
    title: 'Assess warranty and repair eligibility',
    description: 'Operations to confirm whether the product is eligible for repair or replacement under the 2-year support window.',
    status: 'in_progress',
    assignedOwnerId: 'user-ops',
    assignedOwner: userRef('user-ops'),
    updatedById: 'user-ops',
    updatedBy: userRef('user-ops'),
    updatedAI: false,
    createdDate: '2026-05-28T10:15:00.000Z',
    dependencies: [{ actionId: 'action-philip-assess-warranty', dependsOnActionId: 'action-philip-collect-evidence' }],
    comments: [comment('c5', 'action-philip-assess-warranty', 'user-ops', 'Warranty assessment started. Confirming filter blockage vs motor defect.', '2026-05-29T12:10:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-philip-arrange-maintenance',
    issueId: 'issue-philip-gamma-weak-suction',
    title: 'Arrange maintenance slot',
    description: 'Schedule a technician visit or return logistics after warranty assessment is completed.',
    status: 'pending',
    assignedOwnerId: 'user-ops',
    assignedOwner: userRef('user-ops'),
    updatedById: null,
    updatedBy: null,
    updatedAI: false,
    createdDate: '2026-05-29T12:10:00.000Z',
    dependencies: [{ actionId: 'action-philip-arrange-maintenance', dependsOnActionId: 'action-philip-assess-warranty' }],
    comments: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-agostino-review-refund',
    issueId: 'issue-agostino-alpha-late-refund',
    title: 'Review refund eligibility',
    description: 'Check purchase date and compare the request date with the 7-day refund SOP.',
    status: 'completed',
    assignedOwnerId: 'user-crm',
    assignedOwner: userRef('user-crm'),
    updatedById: 'user-crm',
    updatedBy: userRef('user-crm'),
    updatedAI: false,
    createdDate: '2026-05-29T15:15:00.000Z',
    dependencies: [],
    comments: [comment('c6', 'action-agostino-review-refund', 'user-crm', 'Refund request is outside the 7-day eligibility window.', '2026-05-29T17:10:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'action-agostino-communicate-rejection',
    issueId: 'issue-agostino-alpha-late-refund',
    title: 'Communicate rejection reason',
    description: 'Inform customer that the refund request is outside the eligible refund period and provide alternative support options.',
    status: 'rejected',
    assignedOwnerId: 'user-crm',
    assignedOwner: userRef('user-crm'),
    updatedById: 'user-crm',
    updatedBy: userRef('user-crm'),
    updatedAI: true,
    createdDate: '2026-05-29T18:00:00.000Z',
    dependencies: [{ actionId: 'action-agostino-communicate-rejection', dependsOnActionId: 'action-agostino-review-refund' }],
    comments: [comment('c7', 'action-agostino-communicate-rejection', 'user-crm', 'Customer informed about refund rejection and offered repair/maintenance support.', '2026-05-29T18:30:00.000Z')],
    createdAt: now,
    updatedAt: now,
  },
];

function sale(id: string): SaleDto {
  return salesStore.find((s) => s.id === id)!;
}
function actionsForIssue(issueId: string): IssueActionDto[] {
  return actionsStore.filter((action) => action.issueId === issueId);
}

export const issuesStore: Mutable<CustomerIssueDto>[] = [
  {
    id: 'issue-mario-beta-cracked-panel',
    salesId: 'sale-mario-beta-gamma-2026-05-22',
    sale: sale('sale-mario-beta-gamma-2026-05-22'),
    description: 'Customer reported that the Beta cleaning machine arrived with a cracked side panel. Replacement request validated and resolved.',
    dateRaised: '2026-05-23T09:00:00.000Z',
    dateLastUpdate: '2026-05-24T17:30:00.000Z',
    status: 'completed',
    issueActions: actionsForIssue('issue-mario-beta-cracked-panel'),
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'issue-philip-gamma-weak-suction',
    salesId: 'sale-philip-gamma-delta-2026-05-26',
    sale: sale('sale-philip-gamma-delta-2026-05-26'),
    description: 'Customer reported weak suction on one Gamma vacuum cleaner and requested repair or replacement assessment.',
    dateRaised: '2026-05-27T08:40:00.000Z',
    dateLastUpdate: '2026-05-29T12:10:00.000Z',
    status: 'in_assistance',
    issueActions: actionsForIssue('issue-philip-gamma-weak-suction'),
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'issue-agostino-alpha-late-refund',
    salesId: 'sale-agostino-alpha-delta-2026-05-20',
    sale: sale('sale-agostino-alpha-delta-2026-05-20'),
    description: 'Customer requested refund outside the eligible 7-day refund period. Request reviewed against SOP and rejected.',
    dateRaised: '2026-05-29T15:00:00.000Z',
    dateLastUpdate: '2026-05-29T18:30:00.000Z',
    status: 'rejected',
    issueActions: actionsForIssue('issue-agostino-alpha-late-refund'),
    createdAt: now,
    updatedAt: now,
  },
];

export const sopsStore: Mutable<SopDto>[] = [
  {
    id: 'sop-defective-product-replacement',
    name: 'Defective product replacement',
    active: true,
    description: 'Purpose: Replace damaged, defective, incorrect, or missing purchased items.',
    latestVersion: 1,
    details: [
      {
        sopId: 'sop-defective-product-replacement',
        version: 1,
        fullText:
          'Owner: Customer Support\nTime Limit: Customer must request replacement within 1 year from the purchase date.\nSupporting Teams: Inventory, Warehouse, Logistics.\n\nActions\n\n1. Validate the replacement request\nCustomer Support checks the original order, purchase date, issue details, and confirms the request was made within 1 year of purchase.\n\n2. Issue the replacement\nIf approved and stock is available, Operations creates a zero-value replacement order and Logistics ships it.',
        dateOfCreation: '2026-05-01T09:00:00.000Z',
        createdById: 'user-compliance',
        createdBy: userRef('user-compliance'),
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sop-refund-of-purchase',
    name: 'Refund of purchase',
    active: true,
    description: 'Purpose: Handle eligible customer refunds quickly and consistently.',
    latestVersion: 1,
    details: [
      {
        sopId: 'sop-refund-of-purchase',
        version: 1,
        fullText:
          'Owner: Customer Support\nTime Limit: Customer must request the refund within 7 days from the purchase date.\nSupporting Teams: Finance, Warehouse if return is required.\n\nActions\n\n1. Validate the refund request\nCustomer Support checks the order, purchase date, refund reason, and confirms the request was made within 7 days of purchase.\n\n2. Approve and process the refund\nIf eligible, Support approves the case and Finance processes the refund.',
        dateOfCreation: '2026-05-01T09:15:00.000Z',
        createdById: 'user-compliance',
        createdBy: userRef('user-compliance'),
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sop-repair-and-maintenance',
    name: 'Repair and maintenance of product',
    active: true,
    description: 'Purpose: Manage repair or maintenance requests for purchased items.',
    latestVersion: 1,
    details: [
      {
        sopId: 'sop-repair-and-maintenance',
        version: 1,
        fullText:
          'Owner: Service Operations\nTime Limit: Customer must request support or maintenance within 2 years from the purchase date.\nSupporting Teams: Customer Support, Technicians, Logistics.\n\nActions\n\n1. Register and assess the service request\nCustomer Support logs the case. Service Operations checks the purchase date and warranty eligibility.\n\n2. Complete and close the service case\nTechnicians perform the approved repair or maintenance and Service Operations closes the case.',
        dateOfCreation: '2026-05-01T09:30:00.000Z',
        createdById: 'user-compliance',
        createdBy: userRef('user-compliance'),
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
];

export const conversationsStore: Mutable<ConversationDto>[] = [
  {
    id: 'conversation-crm-open-issues',
    userId: 'user-crm',
    title: 'Open issues needing follow-up',
    createdDate: '2026-05-29T09:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm1', conversationId: 'conversation-crm-open-issues', role: 'system', text: 'You are Nova, an operations and customer support assistant.', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T09:00:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm2', conversationId: 'conversation-crm-open-issues', role: 'user', text: 'Show me active issues that need customer support follow-up.', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T09:01:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm3', conversationId: 'conversation-crm-open-issues', role: 'assistant', text: 'There is one active customer issue for Philip Sanders regarding weak suction on a Gamma vacuum cleaner. The next step is to monitor the warranty assessment and prepare a maintenance slot if approved.', isMCPApps: true, MCPAppLink: 'nova://issues/issue-philip-gamma-weak-suction', MCPActive: true, createdDate: '2026-05-29T09:01:15.000Z', createdAt: now, updatedAt: now },
    ],
  },
  {
    id: 'conversation-sales-unpaid-sales',
    userId: 'user-sales',
    title: 'Unpaid sales',
    createdDate: '2026-05-29T10:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm4', conversationId: 'conversation-sales-unpaid-sales', role: 'system', text: 'You are Nova, a sales operations assistant.', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T10:00:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm5', conversationId: 'conversation-sales-unpaid-sales', role: 'user', text: 'Which sales are still unpaid?', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T10:01:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm6', conversationId: 'conversation-sales-unpaid-sales', role: 'assistant', text: 'The Philip Sanders sale from 2026-05-26 is unpaid. The receipt total is 137.75 after a 5% discount.', isMCPApps: true, MCPAppLink: 'nova://sales/sale-philip-gamma-delta-2026-05-26', MCPActive: true, createdDate: '2026-05-29T10:01:20.000Z', createdAt: now, updatedAt: now },
    ],
  },
  {
    id: 'conversation-admin-permissions',
    userId: 'user-admin',
    title: 'Role with full access',
    createdDate: '2026-05-29T11:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm7', conversationId: 'conversation-admin-permissions', role: 'system', text: 'You are Nova, an administrative assistant.', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T11:00:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm8', conversationId: 'conversation-admin-permissions', role: 'user', text: 'Summarise which role has full system access.', isMCPApps: false, MCPAppLink: null, MCPActive: null, createdDate: '2026-05-29T11:01:00.000Z', createdAt: now, updatedAt: now },
      { id: 'm9', conversationId: 'conversation-admin-permissions', role: 'assistant', text: 'The admin role has full system access across customers, issues, sales, permissions, actions, SOPs, and users.', isMCPApps: true, MCPAppLink: 'nova://roles/admin', MCPActive: true, createdDate: '2026-05-29T11:01:20.000Z', createdAt: now, updatedAt: now },
    ],
  },
];

export const ALL_PERMISSIONS = [
  'read-customers', 'write-customers', 'create-issues', 'read-issues', 'write-issues',
  'read-sales', 'write-sales', 'read-permissions', 'write-permissions', 'read-actions',
  'write-actions', 'read-sop', 'write-sop', 'read-users', 'write-users',
] as const;
