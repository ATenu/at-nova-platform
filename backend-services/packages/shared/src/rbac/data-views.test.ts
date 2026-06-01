import {
  accessibleViews,
  MCP_READ_VIEW_PERMISSIONS,
  MCP_WRITE_VIEW_PERMISSIONS,
  permissionForView,
  permissionForWriteView,
  writableViews,
} from './data-views';
import { CAPABILITY_CATALOG } from './capabilities';
import type { Permission } from './permissions';
import { PERMISSIONS } from './permissions';

describe('mcp_read view permissions', () => {
  it('maps every view to a defined domain permission', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const permission of Object.values(MCP_READ_VIEW_PERMISSIONS)) {
      expect(known.has(permission)).toBe(true);
    }
  });

  it('mirrors the REST route permissions', () => {
    expect(permissionForView('customers')).toBe('read-customers');
    expect(permissionForView('sales')).toBe('read-sales');
    expect(permissionForView('products')).toBe('read-sales');
    expect(permissionForView('products_sold')).toBe('read-sales');
    expect(permissionForView('customer_issues')).toBe('read-issues');
    expect(permissionForView('issue_actions')).toBe('read-actions');
    expect(permissionForView('my_assigned_actions')).toBe('read-actions');
    expect(permissionForView('sops')).toBe('read-sop');
    expect(permissionForView('sop_details')).toBe('read-sop');
    expect(permissionForView('users')).toBe('read-users');
  });

  it('returns undefined for an unknown view (default deny)', () => {
    expect(permissionForView('public.secrets')).toBeUndefined();
    expect(permissionForView('does_not_exist')).toBeUndefined();
  });

  it('lists only the views a permission set can read', () => {
    const sales = new Set<Permission>(['read-sales']);
    expect(accessibleViews(sales).sort()).toEqual(['products', 'products_sold', 'sales']);

    const none = new Set<Permission>(['create-agent-run']);
    expect(accessibleViews(none)).toEqual([]);

    const all = new Set<Permission>([
      'read-customers',
      'read-sales',
      'read-issues',
      'read-actions',
      'read-sop',
      'read-users',
    ]);
    expect(accessibleViews(all)).toHaveLength(Object.keys(MCP_READ_VIEW_PERMISSIONS).length);
  });
});

describe('mcp write (domain) permissions', () => {
  it('maps every writable domain to a defined permission', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const permission of Object.values(MCP_WRITE_VIEW_PERMISSIONS)) {
      expect(known.has(permission)).toBe(true);
    }
  });

  it('mirrors the write permission of the equivalent REST mutation', () => {
    expect(permissionForWriteView('sales')).toBe('write-sales');
    expect(permissionForWriteView('products_sold')).toBe('write-sales');
    expect(permissionForWriteView('customer_issues')).toBe('write-issues');
    expect(permissionForWriteView('issue_actions')).toBe('write-actions');
    expect(permissionForWriteView('my_assigned_actions')).toBe('write-actions');
    expect(permissionForWriteView('sops')).toBe('write-sop');
    expect(permissionForWriteView('sop_details')).toBe('write-sop');
  });

  it('does not expose a write mapping for domains with no agent-write capability', () => {
    // `products` has no write permission; `customers`/`users` have no cataloged
    // agent-write capability — so none may be mutated via the agent (default deny).
    expect(permissionForWriteView('products')).toBeUndefined();
    expect(permissionForWriteView('customers')).toBeUndefined();
    expect(permissionForWriteView('users')).toBeUndefined();
    expect(permissionForWriteView('does_not_exist')).toBeUndefined();
  });

  it('keeps every write-domain permission backed by a real cataloged write capability', () => {
    // Contract: the map can never grant write authority the capability catalog
    // does not already define for a delegated (agent-internal) write capability.
    const catalogWritePermissions = new Set<string>(
      CAPABILITY_CATALOG.filter((c) => c.mode === 'write' && c.delegated).flatMap((c) => [
        ...c.requiredPermissions,
      ]),
    );
    for (const permission of Object.values(MCP_WRITE_VIEW_PERMISSIONS)) {
      expect(catalogWritePermissions.has(permission)).toBe(true);
    }
  });

  it('lists only the domains a permission set can write', () => {
    const sales = new Set<Permission>(['write-sales']);
    expect(writableViews(sales).sort()).toEqual(['products_sold', 'sales']);

    const ops = new Set<Permission>(['write-issues', 'write-actions']);
    expect(writableViews(ops).sort()).toEqual([
      'customer_issues',
      'issue_actions',
      'my_assigned_actions',
    ]);

    const readOnly = new Set<Permission>(['read-sales', 'create-agent-run']);
    expect(writableViews(readOnly)).toEqual([]);
  });
});
