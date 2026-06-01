import { accessibleViews, MCP_READ_VIEW_PERMISSIONS, permissionForView } from './data-views';
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
