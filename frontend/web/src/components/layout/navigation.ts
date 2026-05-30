import type { IconName } from '@/components/ui/Icon';
import type { NovaPermission } from '@/auth/permissions';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: IconName;
  /**
   * Permissions that make this item visible. `undefined` means "any
   * authenticated user". Visibility uses ANY-of semantics.
   */
  readonly anyOf?: readonly NovaPermission[];
  readonly end?: boolean;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/app/chat', label: 'Agent Chat', icon: 'chat' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/app/customers', label: 'Customers', icon: 'customers', anyOf: ['read-customers'] },
      { to: '/app/products', label: 'Products', icon: 'product', anyOf: ['read-sales'] },
      { to: '/app/sales', label: 'Sales', icon: 'sales', anyOf: ['read-sales'] },
      { to: '/app/issues', label: 'Issues', icon: 'issues', anyOf: ['read-issues'] },
      { to: '/app/actions', label: 'Actions', icon: 'actions', anyOf: ['read-actions'] },
      { to: '/app/sops', label: 'SOPs', icon: 'sop', anyOf: ['read-sop'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/app/admin/users', label: 'Users', icon: 'users', anyOf: ['read-users'] },
      {
        to: '/app/admin/roles',
        label: 'Roles & Permissions',
        icon: 'shield',
        anyOf: ['read-permissions'],
      },
    ],
  },
];
