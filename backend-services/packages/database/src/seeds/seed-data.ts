import type { Role } from '@nova/shared';
import { CustomerIssueStatus, IssueActionStatus, MessageRole } from '../enums';

/**
 * Canonical seed data. Typos from the original source have been corrected
 * (firstName, quantity, Conversation, maintenance, ...). No passwords are
 * stored or processed anywhere; user records are profile data only.
 *
 * RBAC permissions and role->permission grants are intentionally NOT duplicated
 * here. They are sourced from `@nova/shared` (PERMISSIONS, ROLE_PERMISSIONS) so
 * the seeded rows can never diverge from runtime authorization decisions.
 */

export interface UserSeed {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly description: string;
}

export const usersSeed: readonly UserSeed[] = [
  {
    email: 'admin@test.com',
    firstName: 'admin',
    lastName: 'admin',
    description: 'super admin users and system admin',
  },
  { email: 'salesman@test.com', firstName: 'sales', lastName: 'man', description: 'sales team' },
  {
    email: 'opsman@test.com',
    firstName: 'ope',
    lastName: 'man',
    description: 'operations and maintenance team',
  },
  {
    email: 'compliance@test.com',
    firstName: 'compliance',
    lastName: 'ops',
    description: 'compliance team',
  },
  {
    email: 'crm@test.com',
    firstName: 'customer',
    lastName: 'support',
    description: 'customer support team',
  },
];

export interface RoleSeed {
  readonly name: Role;
  readonly description: string;
}

export const rolesSeed: readonly RoleSeed[] = [
  { name: 'sales-user', description: 'sales team' },
  { name: 'support-operations-user', description: 'operations team' },
  { name: 'admin', description: 'super admin users and system admin' },
  { name: 'customer-support', description: 'customer support team' },
  { name: 'ops-compliance', description: 'compliance team' },
];

export interface UserRoleSeed {
  readonly email: string;
  readonly role: Role;
}

export const userRolesSeed: readonly UserRoleSeed[] = [
  { email: 'admin@test.com', role: 'admin' },
  { email: 'salesman@test.com', role: 'sales-user' },
  { email: 'opsman@test.com', role: 'support-operations-user' },
  { email: 'compliance@test.com', role: 'ops-compliance' },
  { email: 'crm@test.com', role: 'customer-support' },
];

export interface CustomerSeed {
  readonly email: string;
  readonly fullName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number;
  readonly active: boolean;
}

export const customersSeed: readonly CustomerSeed[] = [
  {
    email: 'agostino.tenuta@mc.com',
    fullName: 'Agostino Tenuta',
    firstName: 'Agostino',
    lastName: 'Tenuta',
    age: 31,
    active: true,
  },
  {
    email: 'mario@ar.com',
    fullName: 'Mario Rossi',
    firstName: 'Mario',
    lastName: 'Rossi',
    age: 45,
    active: true,
  },
  {
    email: 'philip.sanders@rs.com',
    fullName: 'Philip Sanders',
    firstName: 'Philip',
    lastName: 'Sanders',
    age: 50,
    active: true,
  },
];

export interface ProductSeed {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly price: string;
  readonly inCatalog: boolean;
}

export const productsSeed: readonly ProductSeed[] = [
  {
    name: 'Alpha',
    description:
      'Alpha is an industrial metal brush to clean up material waste from production lines',
    category: 'industrial-merchandising',
    price: '200.00',
    inCatalog: true,
  },
  {
    name: 'Beta',
    description: 'Beta is a top gamma cleaning machine for private houses',
    category: 'house-merchandising',
    price: '150.00',
    inCatalog: true,
  },
  {
    name: 'Gamma',
    description: 'Gamma is an economy vacuum cleaner for private houses',
    category: 'house-merchandising',
    price: '50.00',
    inCatalog: true,
  },
  {
    name: 'Delta',
    description: 'Delta consists of a pack of 5 vacuum bags, compatible with both Beta and Gamma',
    category: 'house-merchandising',
    price: '15.00',
    inCatalog: true,
  },
];

export interface SopSeed {
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly fullText: string;
  readonly createdByEmail: string;
  readonly dateOfCreation: string;
  readonly active: boolean;
}

export const sopsSeed: readonly SopSeed[] = [
  {
    version: 1,
    title: 'Defective product replacement',
    description: 'Purpose: Replace damaged, defective, incorrect, or missing purchased items.',
    fullText: `Owner: Customer Support
Time Limit: Customer must request replacement within 1 year from the purchase date.
Supporting Teams: Inventory, Warehouse, Logistics.

Actions

1. Validate the replacement request
Customer Support checks the original order, purchase date, issue details, and confirms the request was made within 1 year of purchase.

2. Issue the replacement
If approved and stock is available, Operations creates a zero-value replacement order and Logistics ships it. If no longer in production, Support offers an alternative, backorder, or refund.`,
    createdByEmail: 'compliance@test.com',
    dateOfCreation: '2026-05-01T09:00:00.000Z',
    active: true,
  },
  {
    version: 1,
    title: 'Refund of purchase',
    description: 'Purpose: Handle eligible customer refunds quickly and consistently.',
    fullText: `Owner: Customer Support
Time Limit: Customer must request the refund within 7 days from the purchase date.
Supporting Teams: Finance, Warehouse if return is required.

Actions

1. Validate the refund request
Customer Support checks the order, purchase date, refund reason, and confirms the request was made within 7 days of purchase.

2. Approve and process the refund
If eligible, Support approves the case and Finance processes the refund. If not eligible, Support informs the customer with the reason.`,
    createdByEmail: 'compliance@test.com',
    dateOfCreation: '2026-05-01T09:15:00.000Z',
    active: true,
  },
  {
    version: 1,
    title: 'Repair and maintenance of product',
    description: 'Purpose: Manage repair or maintenance requests for purchased items.',
    fullText: `Owner: Service Operations
Time Limit: Customer must request support or maintenance within 2 years from the purchase date.
Supporting Teams: Customer Support, Technicians, Logistics.

Actions

1. Register and assess the service request
Customer Support logs the case. Service Operations checks the purchase date, warranty or support eligibility, and confirms the request was made within 2 years of purchase.

2. Complete and close the service case
Technicians perform the approved repair or maintenance. Service Operations confirms completion, arranges return if needed, and closes the case.`,
    createdByEmail: 'compliance@test.com',
    dateOfCreation: '2026-05-01T09:30:00.000Z',
    active: true,
  },
];

export interface SaleItemSeed {
  readonly productName: string;
  readonly quantity: number;
}

export interface SaleSeed {
  readonly seedKey: string;
  readonly customerEmail: string;
  readonly date: string;
  readonly discountApplied: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment: string | null;
  readonly items: readonly SaleItemSeed[];
  readonly totalAmountReceipt: string;
}

export const salesSeed: readonly SaleSeed[] = [
  {
    seedKey: 'sale-agostino-alpha-delta-2026-05-20',
    customerEmail: 'agostino.tenuta@mc.com',
    date: '2026-05-20T10:30:00.000Z',
    discountApplied: '10.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-20T10:35:00.000Z',
    items: [
      { productName: 'Alpha', quantity: 1 },
      { productName: 'Delta', quantity: 2 },
    ],
    totalAmountReceipt: '207.00',
  },
  {
    seedKey: 'sale-mario-beta-gamma-2026-05-22',
    customerEmail: 'mario@ar.com',
    date: '2026-05-22T14:15:00.000Z',
    discountApplied: '0.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-22T14:20:00.000Z',
    items: [
      { productName: 'Beta', quantity: 1 },
      { productName: 'Gamma', quantity: 1 },
    ],
    totalAmountReceipt: '200.00',
  },
  {
    seedKey: 'sale-philip-gamma-delta-2026-05-26',
    customerEmail: 'philip.sanders@rs.com',
    date: '2026-05-26T16:45:00.000Z',
    discountApplied: '5.00',
    paymentReceived: false,
    dateOfPayment: null,
    items: [
      { productName: 'Gamma', quantity: 2 },
      { productName: 'Delta', quantity: 3 },
    ],
    totalAmountReceipt: '137.75',
  },
  {
    seedKey: 'sale-agostino-beta-2026-05-27',
    customerEmail: 'agostino.tenuta@mc.com',
    date: '2026-05-27T11:10:00.000Z',
    discountApplied: '0.00',
    paymentReceived: true,
    dateOfPayment: '2026-05-27T11:12:00.000Z',
    items: [{ productName: 'Beta', quantity: 1 }],
    totalAmountReceipt: '150.00',
  },
];

export interface CustomerIssueSeed {
  readonly seedKey: string;
  readonly saleSeedKey: string;
  readonly description: string;
  readonly dateRaised: string;
  readonly dateLastUpdate: string;
  readonly status: CustomerIssueStatus;
}

export const customerIssuesSeed: readonly CustomerIssueSeed[] = [
  {
    seedKey: 'issue-mario-beta-cracked-panel',
    saleSeedKey: 'sale-mario-beta-gamma-2026-05-22',
    description:
      'Customer reported that the Beta cleaning machine arrived with a cracked side panel. Replacement request validated and resolved.',
    dateRaised: '2026-05-23T09:00:00.000Z',
    dateLastUpdate: '2026-05-24T17:30:00.000Z',
    status: CustomerIssueStatus.COMPLETED,
  },
  {
    seedKey: 'issue-philip-gamma-weak-suction',
    saleSeedKey: 'sale-philip-gamma-delta-2026-05-26',
    description:
      'Customer reported weak suction on one Gamma vacuum cleaner and requested repair or replacement assessment.',
    dateRaised: '2026-05-27T08:40:00.000Z',
    dateLastUpdate: '2026-05-29T12:10:00.000Z',
    status: CustomerIssueStatus.IN_ASSISTANCE,
  },
  {
    seedKey: 'issue-agostino-alpha-late-refund',
    saleSeedKey: 'sale-agostino-alpha-delta-2026-05-20',
    description:
      'Customer requested refund outside the eligible 7-day refund period. Request reviewed against SOP and rejected.',
    dateRaised: '2026-05-29T15:00:00.000Z',
    dateLastUpdate: '2026-05-29T18:30:00.000Z',
    status: CustomerIssueStatus.REJECTED,
  },
];

export interface IssueActionSeed {
  readonly seedKey: string;
  readonly issueSeedKey: string;
  readonly title: string;
  readonly description: string;
  readonly status: IssueActionStatus;
  readonly assignedOwnerEmail: string;
  readonly updatedByEmail: string | null;
  readonly updatedAI: boolean;
  readonly createdDate: string;
  readonly dependsOn: readonly string[];
}

export const issueActionsSeed: readonly IssueActionSeed[] = [
  {
    seedKey: 'action-mario-validate-replacement',
    issueSeedKey: 'issue-mario-beta-cracked-panel',
    title: 'Validate replacement request',
    description: 'Check original sale, product, purchase date, and reported defect evidence.',
    status: IssueActionStatus.COMPLETED,
    assignedOwnerEmail: 'crm@test.com',
    updatedByEmail: 'crm@test.com',
    updatedAI: false,
    createdDate: '2026-05-23T09:10:00.000Z',
    dependsOn: [],
  },
  {
    seedKey: 'action-mario-ship-replacement',
    issueSeedKey: 'issue-mario-beta-cracked-panel',
    title: 'Ship replacement Beta unit',
    description: 'Operations to create zero-value replacement order and prepare shipment.',
    status: IssueActionStatus.COMPLETED,
    assignedOwnerEmail: 'opsman@test.com',
    updatedByEmail: 'opsman@test.com',
    updatedAI: false,
    createdDate: '2026-05-23T11:00:00.000Z',
    dependsOn: ['action-mario-validate-replacement'],
  },
  {
    seedKey: 'action-mario-notify-customer',
    issueSeedKey: 'issue-mario-beta-cracked-panel',
    title: 'Notify customer of completed replacement',
    description: 'Customer support to confirm shipment and close the customer issue.',
    status: IssueActionStatus.COMPLETED,
    assignedOwnerEmail: 'crm@test.com',
    updatedByEmail: 'crm@test.com',
    updatedAI: true,
    createdDate: '2026-05-24T16:45:00.000Z',
    dependsOn: ['action-mario-ship-replacement'],
  },
  {
    seedKey: 'action-philip-collect-evidence',
    issueSeedKey: 'issue-philip-gamma-weak-suction',
    title: 'Collect customer evidence',
    description:
      'Ask customer to provide photos, short video, and usage description for the Gamma vacuum cleaner.',
    status: IssueActionStatus.COMPLETED,
    assignedOwnerEmail: 'crm@test.com',
    updatedByEmail: 'crm@test.com',
    updatedAI: false,
    createdDate: '2026-05-27T09:00:00.000Z',
    dependsOn: [],
  },
  {
    seedKey: 'action-philip-assess-warranty',
    issueSeedKey: 'issue-philip-gamma-weak-suction',
    title: 'Assess warranty and repair eligibility',
    description:
      'Operations to confirm whether the product is eligible for repair or replacement under the 2-year support window.',
    status: IssueActionStatus.IN_PROGRESS,
    assignedOwnerEmail: 'opsman@test.com',
    updatedByEmail: 'opsman@test.com',
    updatedAI: false,
    createdDate: '2026-05-28T10:15:00.000Z',
    dependsOn: ['action-philip-collect-evidence'],
  },
  {
    seedKey: 'action-philip-arrange-maintenance',
    issueSeedKey: 'issue-philip-gamma-weak-suction',
    title: 'Arrange maintenance slot',
    description:
      'Schedule a technician visit or return logistics after warranty assessment is completed.',
    status: IssueActionStatus.PENDING,
    assignedOwnerEmail: 'opsman@test.com',
    updatedByEmail: null,
    updatedAI: false,
    createdDate: '2026-05-29T12:10:00.000Z',
    dependsOn: ['action-philip-assess-warranty'],
  },
  {
    seedKey: 'action-agostino-review-refund',
    issueSeedKey: 'issue-agostino-alpha-late-refund',
    title: 'Review refund eligibility',
    description: 'Check purchase date and compare the request date with the 7-day refund SOP.',
    status: IssueActionStatus.COMPLETED,
    assignedOwnerEmail: 'crm@test.com',
    updatedByEmail: 'crm@test.com',
    updatedAI: false,
    createdDate: '2026-05-29T15:15:00.000Z',
    dependsOn: [],
  },
  {
    seedKey: 'action-agostino-communicate-rejection',
    issueSeedKey: 'issue-agostino-alpha-late-refund',
    title: 'Communicate rejection reason',
    description:
      'Inform customer that the refund request is outside the eligible refund period and provide alternative support options.',
    status: IssueActionStatus.REJECTED,
    assignedOwnerEmail: 'crm@test.com',
    updatedByEmail: 'crm@test.com',
    updatedAI: true,
    createdDate: '2026-05-29T18:00:00.000Z',
    dependsOn: ['action-agostino-review-refund'],
  },
];

export interface ActionCommentSeed {
  readonly actionSeedKey: string;
  readonly userEmail: string;
  readonly comment: string;
  readonly datetime: string;
}

export const actionCommentsSeed: readonly ActionCommentSeed[] = [
  {
    actionSeedKey: 'action-mario-validate-replacement',
    userEmail: 'crm@test.com',
    comment:
      'Purchase date and product details validated. Replacement request is within the 1-year replacement window.',
    datetime: '2026-05-23T09:45:00.000Z',
  },
  {
    actionSeedKey: 'action-mario-ship-replacement',
    userEmail: 'opsman@test.com',
    comment: 'Replacement Beta unit prepared and handed to logistics.',
    datetime: '2026-05-24T11:20:00.000Z',
  },
  {
    actionSeedKey: 'action-mario-notify-customer',
    userEmail: 'crm@test.com',
    comment: 'Customer notified. Issue closed successfully.',
    datetime: '2026-05-24T17:30:00.000Z',
  },
  {
    actionSeedKey: 'action-philip-collect-evidence',
    userEmail: 'crm@test.com',
    comment:
      'Customer sent a short video showing weak suction. Evidence attached to internal case record.',
    datetime: '2026-05-27T15:25:00.000Z',
  },
  {
    actionSeedKey: 'action-philip-assess-warranty',
    userEmail: 'opsman@test.com',
    comment:
      'Warranty assessment started. Need to confirm whether the issue is caused by filter blockage or motor defect.',
    datetime: '2026-05-29T12:10:00.000Z',
  },
  {
    actionSeedKey: 'action-agostino-review-refund',
    userEmail: 'crm@test.com',
    comment: 'Refund request is outside the 7-day eligibility window.',
    datetime: '2026-05-29T17:10:00.000Z',
  },
  {
    actionSeedKey: 'action-agostino-communicate-rejection',
    userEmail: 'crm@test.com',
    comment:
      'Customer informed about refund rejection and offered repair/maintenance support if needed.',
    datetime: '2026-05-29T18:30:00.000Z',
  },
];

export interface MessageSeed {
  readonly role: MessageRole;
  readonly text: string;
  readonly isMCPApps: boolean;
  readonly MCPAppLink: string | null;
  readonly MCPActive: boolean | null;
  readonly createdDate: string;
}

export interface ConversationSeed {
  readonly seedKey: string;
  readonly userEmail: string;
  readonly createdDate: string;
  readonly messages: readonly MessageSeed[];
}

export const conversationsSeed: readonly ConversationSeed[] = [
  {
    seedKey: 'conversation-crm-open-issues',
    userEmail: 'crm@test.com',
    createdDate: '2026-05-29T09:00:00.000Z',
    messages: [
      {
        role: MessageRole.SYSTEM,
        text: 'You are Nova, an operations and customer support assistant. Use customer, sales, issue, action, and SOP data to help users resolve operational work.',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T09:00:00.000Z',
      },
      {
        role: MessageRole.USER,
        text: 'Show me active issues that need customer support follow-up.',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T09:01:00.000Z',
      },
      {
        role: MessageRole.ASSISTANT,
        text: 'There is one active customer issue for Philip Sanders regarding weak suction on a Gamma vacuum cleaner. The next support step is to monitor the warranty assessment and prepare a maintenance slot if approved.',
        isMCPApps: true,
        MCPAppLink: 'nova://issues/issue-philip-gamma-weak-suction',
        MCPActive: true,
        createdDate: '2026-05-29T09:01:15.000Z',
      },
    ],
  },
  {
    seedKey: 'conversation-sales-unpaid-sales',
    userEmail: 'salesman@test.com',
    createdDate: '2026-05-29T10:00:00.000Z',
    messages: [
      {
        role: MessageRole.SYSTEM,
        text: 'You are Nova, a sales operations assistant. Help users inspect sales, payment status, customers, and related issues.',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T10:00:00.000Z',
      },
      {
        role: MessageRole.USER,
        text: 'Which sales are still unpaid?',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T10:01:00.000Z',
      },
      {
        role: MessageRole.ASSISTANT,
        text: 'The Philip Sanders sale from 2026-05-26 is unpaid. The receipt total is 137.75 after a 5% discount.',
        isMCPApps: true,
        MCPAppLink: 'nova://sales/sale-philip-gamma-delta-2026-05-26',
        MCPActive: true,
        createdDate: '2026-05-29T10:01:20.000Z',
      },
    ],
  },
  {
    seedKey: 'conversation-admin-permissions',
    userEmail: 'admin@test.com',
    createdDate: '2026-05-29T11:00:00.000Z',
    messages: [
      {
        role: MessageRole.SYSTEM,
        text: 'You are Nova, an administrative assistant. Help administrators inspect roles, permissions, users, and operational data.',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T11:00:00.000Z',
      },
      {
        role: MessageRole.USER,
        text: 'Summarise which role has full system access.',
        isMCPApps: false,
        MCPAppLink: null,
        MCPActive: null,
        createdDate: '2026-05-29T11:01:00.000Z',
      },
      {
        role: MessageRole.ASSISTANT,
        text: 'The admin role has full system access across customers, issues, sales, permissions, actions, SOPs, and users.',
        isMCPApps: true,
        MCPAppLink: 'nova://roles/admin',
        MCPActive: true,
        createdDate: '2026-05-29T11:01:20.000Z',
      },
    ],
  },
];
