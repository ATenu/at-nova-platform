import 'reflect-metadata';
import type { DataSource, EntityManager } from 'typeorm';
import {
  CAPABILITY_CATALOG,
  MCP_READ_VIEW_PERMISSIONS,
  MCP_WRITE_VIEW_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from '@nova/shared';
import { AppDataSource } from '../data-source';
import {
  ActionComment,
  Capability,
  CapabilityPermission,
  Conversation,
  Customer,
  CustomerIssue,
  IssueAction,
  IssueActionDependency,
  Message,
  Permission,
  Product,
  ProductSold,
  Role,
  RolePermission,
  Sale,
  Sop,
  SopDetail,
  User,
  UserRole,
  ViewPermission,
} from '../entities';
import {
  actionCommentsSeed,
  conversationsSeed,
  customerIssuesSeed,
  customersSeed,
  issueActionsSeed,
  productsSeed,
  rolesSeed,
  salesSeed,
  sopsSeed,
  userRolesSeed,
  usersSeed,
} from './seed-data';
import { seedUuid } from './seed-uuid';

/** Tables emptied (in this order) before reseeding when SEED_RESET is enabled. */
const RESET_ORDER: readonly string[] = [
  'messages',
  'conversations',
  'action_comments',
  'issue_action_dependencies',
  'issue_actions',
  'customer_issues',
  'products_sold',
  'sales',
  'sop_details',
  'sops',
  'capability_permissions',
  'capabilities',
  'view_permissions',
  'role_permissions',
  'user_roles',
  'permissions',
  'roles',
  'products',
  'customers',
  'users',
];

const SUMMARY_TABLES: readonly string[] = [
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'capabilities',
  'capability_permissions',
  'view_permissions',
  'customers',
  'products',
  'sops',
  'sop_details',
  'sales',
  'products_sold',
  'customer_issues',
  'issue_actions',
  'issue_action_dependencies',
  'action_comments',
  'conversations',
  'messages',
];

function requireValue<T>(map: ReadonlyMap<string, T>, key: string, label: string): T {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Seed integrity error: missing ${label} for key "${key}".`);
  }
  return value;
}

/** Convert a 2-decimal money string into integer cents to avoid float drift. */
function toCents(amount: string): number {
  return Math.round(Number.parseFloat(amount) * 100);
}

/** Validate that the configured receipt total matches the line items + discount. */
function assertSaleTotal(
  seedKey: string,
  items: readonly { priceCents: number; quantity: number }[],
  discountPercent: string,
  expectedTotal: string,
): void {
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const discountCents = Math.round((subtotalCents * Number.parseFloat(discountPercent)) / 100);
  const totalCents = subtotalCents - discountCents;
  const expectedCents = toCents(expectedTotal);

  if (totalCents !== expectedCents) {
    throw new Error(
      `Sale "${seedKey}" total mismatch: computed ${(totalCents / 100).toFixed(2)} ` +
        `but seed declares ${expectedTotal}.`,
    );
  }
}

async function resetSeededData(manager: EntityManager): Promise<void> {
  for (const table of RESET_ORDER) {
    await manager.query(`DELETE FROM "${table}"`);
  }
}

async function seedUsers(manager: EntityManager): Promise<Map<string, string>> {
  await manager.upsert(
    User,
    usersSeed.map((user) => ({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      description: user.description,
    })),
    { conflictPaths: ['email'], skipUpdateIfNoValuesChanged: true },
  );

  const users = await manager.find(User);
  return new Map(users.map((user) => [user.email, user.id]));
}

async function seedRolesAndPermissions(manager: EntityManager): Promise<void> {
  // Built-in roles/permissions are flagged `is_system` so the admin API protects
  // them from deletion while still allowing their grants to be edited.
  await manager.upsert(
    Role,
    rolesSeed.map((role) => ({ name: role.name, description: role.description, isSystem: true })),
    { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: true },
  );

  await manager.upsert(
    Permission,
    PERMISSIONS.map((name) => ({ name, isSystem: true })),
    { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: true },
  );

  const rolePermissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(([roleName, permissions]) =>
    permissions.map((permissionName) => ({ roleName, permissionName })),
  );

  await manager
    .createQueryBuilder()
    .insert()
    .into(RolePermission)
    .values(rolePermissionRows)
    .orIgnore()
    .execute();
}

async function seedCapabilities(manager: EntityManager): Promise<void> {
  await manager.upsert(
    Capability,
    CAPABILITY_CATALOG.map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      mode: capability.mode,
      risk: capability.risk,
      resourceScoped: capability.resourceScoped,
      delegated: capability.delegated ?? false,
      enabled: true,
      requiresApproval: capability.requiresApproval ?? false,
      isSystem: true,
    })),
    { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true },
  );

  const rows = CAPABILITY_CATALOG.flatMap((capability) =>
    capability.requiredPermissions.map((permissionName) => ({
      capabilityId: capability.id,
      permissionName,
    })),
  );

  if (rows.length > 0) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(CapabilityPermission)
      .values(rows)
      .orIgnore()
      .execute();
  }
}

async function seedViewPermissions(manager: EntityManager): Promise<void> {
  const readRows = Object.entries(MCP_READ_VIEW_PERMISSIONS).map(([viewName, permissionName]) => ({
    viewName,
    mode: 'read',
    permissionName,
    isSystem: true,
  }));
  const writeRows = Object.entries(MCP_WRITE_VIEW_PERMISSIONS).map(([viewName, permissionName]) => ({
    viewName,
    mode: 'write',
    permissionName,
    isSystem: true,
  }));

  await manager.upsert(ViewPermission, [...readRows, ...writeRows], {
    conflictPaths: ['viewName', 'mode'],
    skipUpdateIfNoValuesChanged: true,
  });
}

async function seedUserRoles(
  manager: EntityManager,
  userIdByEmail: Map<string, string>,
): Promise<void> {
  const rows = userRolesSeed.map((assignment) => ({
    userId: requireValue(userIdByEmail, assignment.email, 'user'),
    roleName: assignment.role,
  }));

  await manager.createQueryBuilder().insert().into(UserRole).values(rows).orIgnore().execute();
}

async function seedCustomers(manager: EntityManager): Promise<void> {
  await manager.upsert(
    Customer,
    customersSeed.map((customer) => ({ ...customer })),
    { conflictPaths: ['email'], skipUpdateIfNoValuesChanged: true },
  );
}

interface SeededProduct {
  readonly id: string;
  readonly priceCents: number;
}

async function seedProducts(manager: EntityManager): Promise<Map<string, SeededProduct>> {
  await manager.upsert(
    Product,
    productsSeed.map((product) => ({ ...product })),
    { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: true },
  );

  const products = await manager.find(Product);
  return new Map(
    products.map((product) => [
      product.name,
      { id: product.id, priceCents: toCents(product.price) },
    ]),
  );
}

async function seedSops(manager: EntityManager, userIdByEmail: Map<string, string>): Promise<void> {
  await manager.upsert(
    Sop,
    sopsSeed.map((sop) => ({ name: sop.title, active: sop.active, description: sop.description })),
    { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: true },
  );

  const sops = await manager.find(Sop);
  const sopIdByName = new Map(sops.map((sop) => [sop.name, sop.id]));

  await manager.upsert(
    SopDetail,
    sopsSeed.map((sop) => ({
      sopId: requireValue(sopIdByName, sop.title, 'sop'),
      version: sop.version,
      fullText: sop.fullText,
      dateOfCreation: new Date(sop.dateOfCreation),
      createdById: requireValue(userIdByEmail, sop.createdByEmail, 'user'),
    })),
    { conflictPaths: ['sopId', 'version'], skipUpdateIfNoValuesChanged: true },
  );
}

async function seedSales(
  manager: EntityManager,
  customerIdByEmail: Map<string, string>,
  productByName: Map<string, SeededProduct>,
): Promise<Map<string, string>> {
  const saleIdBySeedKey = new Map<string, string>();
  const productSoldRows: { saleId: string; productId: string; quantity: number }[] = [];

  const saleRows = salesSeed.map((sale) => {
    const lineItems = sale.items.map((item) => {
      const product = requireValue(productByName, item.productName, 'product');
      return { product, quantity: item.quantity };
    });

    assertSaleTotal(
      sale.seedKey,
      lineItems.map((item) => ({ priceCents: item.product.priceCents, quantity: item.quantity })),
      sale.discountApplied,
      sale.totalAmountReceipt,
    );

    const saleId = seedUuid(sale.seedKey);
    saleIdBySeedKey.set(sale.seedKey, saleId);

    for (const item of lineItems) {
      productSoldRows.push({ saleId, productId: item.product.id, quantity: item.quantity });
    }

    return {
      id: saleId,
      customerId: requireValue(customerIdByEmail, sale.customerEmail, 'customer'),
      discountApplied: sale.discountApplied,
      date: new Date(sale.date),
      totalAmountReceipt: sale.totalAmountReceipt,
      paymentReceived: sale.paymentReceived,
      dateOfPayment: sale.dateOfPayment ? new Date(sale.dateOfPayment) : null,
    };
  });

  await manager.upsert(Sale, saleRows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });
  await manager
    .createQueryBuilder()
    .insert()
    .into(ProductSold)
    .values(productSoldRows)
    .orIgnore()
    .execute();

  return saleIdBySeedKey;
}

async function seedCustomerIssues(
  manager: EntityManager,
  saleIdBySeedKey: Map<string, string>,
): Promise<Map<string, string>> {
  const issueIdBySeedKey = new Map<string, string>();

  const rows = customerIssuesSeed.map((issue) => {
    const id = seedUuid(issue.seedKey);
    issueIdBySeedKey.set(issue.seedKey, id);
    return {
      id,
      salesId: requireValue(saleIdBySeedKey, issue.saleSeedKey, 'sale'),
      description: issue.description,
      dateRaised: new Date(issue.dateRaised),
      dateLastUpdate: new Date(issue.dateLastUpdate),
      status: issue.status,
    };
  });

  await manager.upsert(CustomerIssue, rows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });
  return issueIdBySeedKey;
}

async function seedIssueActions(
  manager: EntityManager,
  issueIdBySeedKey: Map<string, string>,
  userIdByEmail: Map<string, string>,
): Promise<Map<string, string>> {
  const actionIdBySeedKey = new Map<string, string>();

  const rows = issueActionsSeed.map((action) => {
    const id = seedUuid(action.seedKey);
    actionIdBySeedKey.set(action.seedKey, id);
    return {
      id,
      issueId: requireValue(issueIdBySeedKey, action.issueSeedKey, 'issue'),
      title: action.title,
      description: action.description,
      status: action.status,
      assignedOwnerId: requireValue(userIdByEmail, action.assignedOwnerEmail, 'user'),
      updatedById: action.updatedByEmail
        ? requireValue(userIdByEmail, action.updatedByEmail, 'user')
        : null,
      updatedAI: action.updatedAI,
      createdDate: new Date(action.createdDate),
    };
  });

  await manager.upsert(IssueAction, rows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });

  const dependencyRows = issueActionsSeed.flatMap((action) =>
    action.dependsOn.map((dependsOnSeedKey) => ({
      actionId: requireValue(actionIdBySeedKey, action.seedKey, 'action'),
      dependsOnActionId: requireValue(actionIdBySeedKey, dependsOnSeedKey, 'action'),
    })),
  );

  if (dependencyRows.length > 0) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(IssueActionDependency)
      .values(dependencyRows)
      .orIgnore()
      .execute();
  }

  return actionIdBySeedKey;
}

async function seedActionComments(
  manager: EntityManager,
  actionIdBySeedKey: Map<string, string>,
  userIdByEmail: Map<string, string>,
): Promise<void> {
  const rows = actionCommentsSeed.map((comment) => ({
    id: seedUuid(`${comment.actionSeedKey}:${comment.userEmail}:${comment.datetime}`),
    issueActionId: requireValue(actionIdBySeedKey, comment.actionSeedKey, 'action'),
    userId: requireValue(userIdByEmail, comment.userEmail, 'user'),
    comment: comment.comment,
    datetime: new Date(comment.datetime),
  }));

  await manager.upsert(ActionComment, rows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });
}

async function seedConversations(
  manager: EntityManager,
  userIdByEmail: Map<string, string>,
): Promise<void> {
  const conversationRows = conversationsSeed.map((conversation) => ({
    id: seedUuid(conversation.seedKey),
    userId: requireValue(userIdByEmail, conversation.userEmail, 'user'),
    createdDate: new Date(conversation.createdDate),
  }));

  await manager.upsert(Conversation, conversationRows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });

  const messageRows = conversationsSeed.flatMap((conversation) =>
    conversation.messages.map((message, index) => ({
      id: seedUuid(`${conversation.seedKey}:message:${index}`),
      conversationId: seedUuid(conversation.seedKey),
      role: message.role,
      text: message.text,
      isMCPApps: message.isMCPApps,
      MCPAppLink: message.MCPAppLink,
      MCPActive: message.MCPActive,
      createdDate: new Date(message.createdDate),
    })),
  );

  await manager.upsert(Message, messageRows, {
    conflictPaths: ['id'],
    skipUpdateIfNoValuesChanged: true,
  });
}

export interface SeedOptions {
  /** When true, seeded data is deleted and recreated. Ignored in production. */
  readonly reset?: boolean;
  /** Current environment; used to gate destructive reset. */
  readonly environment?: string;
}

/** Seed counts keyed by table name. */
export type SeedSummary = Readonly<Record<string, number>>;

/**
 * Seed the database idempotently inside a single transaction. Safe to run
 * repeatedly; re-running never duplicates rows.
 */
export async function seedDatabase(
  dataSource: DataSource,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  return dataSource.transaction(async (manager) => {
    const allowReset = options.reset === true && options.environment !== 'production';
    if (allowReset) {
      await resetSeededData(manager);
    }

    const userIdByEmail = await seedUsers(manager);
    await seedRolesAndPermissions(manager);
    await seedCapabilities(manager);
    await seedViewPermissions(manager);
    await seedUserRoles(manager, userIdByEmail);
    await seedCustomers(manager);
    const productByName = await seedProducts(manager);
    await seedSops(manager, userIdByEmail);

    const customers = await manager.find(Customer);
    const customerIdByEmail = new Map(customers.map((customer) => [customer.email, customer.id]));

    const saleIdBySeedKey = await seedSales(manager, customerIdByEmail, productByName);
    const issueIdBySeedKey = await seedCustomerIssues(manager, saleIdBySeedKey);
    const actionIdBySeedKey = await seedIssueActions(manager, issueIdBySeedKey, userIdByEmail);
    await seedActionComments(manager, actionIdBySeedKey, userIdByEmail);
    await seedConversations(manager, userIdByEmail);

    const summaryEntries = await Promise.all(
      SUMMARY_TABLES.map(async (table): Promise<[string, number]> => {
        const result: unknown = await manager.query(
          `SELECT COUNT(*)::int AS count FROM "${table}"`,
        );
        const rows = result as Array<{ count: number }>;
        return [table, rows[0]?.count ?? 0];
      }),
    );

    return Object.fromEntries(summaryEntries);
  });
}

async function main(): Promise<void> {
  const dataSource = await AppDataSource.initialize();
  try {
    const summary = await seedDatabase(dataSource, {
      reset: process.env.SEED_RESET === 'true',
      ...(process.env.NODE_ENV !== undefined ? { environment: process.env.NODE_ENV } : {}),
    });

    console.log('Nova DB seed completed successfully.');
    for (const [table, count] of Object.entries(summary)) {
      console.log(`${table}: ${count}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Nova DB seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
