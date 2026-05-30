import type { NovaRole } from './permissions';

/**
 * The deterministic seeded users (mirrors the backend seed and the Keycloak
 * realm import). Used by the local dev login picker when running in mock mode.
 * These are development fixtures only — no passwords are stored here.
 */
export interface DemoUser {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: NovaRole;
  readonly description: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { email: 'admin@test.com', firstName: 'admin', lastName: 'admin', role: 'admin', description: 'Full system access' },
  { email: 'salesman@test.com', firstName: 'sales', lastName: 'man', role: 'sales-user', description: 'Sales team' },
  {
    email: 'opsman@test.com',
    firstName: 'ope',
    lastName: 'man',
    role: 'support-operations-user',
    description: 'Operations & maintenance',
  },
  {
    email: 'compliance@test.com',
    firstName: 'compliance',
    lastName: 'ops',
    role: 'ops-compliance',
    description: 'Compliance team',
  },
  {
    email: 'crm@test.com',
    firstName: 'customer',
    lastName: 'support',
    role: 'customer-support',
    description: 'Customer support',
  },
];
