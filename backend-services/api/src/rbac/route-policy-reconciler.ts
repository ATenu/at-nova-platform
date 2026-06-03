import { RoutePolicy } from '@nova/database';
import type { DataSource } from 'typeorm';
import type { RouteAccessPolicy } from '../auth/route-policy';

interface RoutePolicyRow {
  readonly routeId: string;
  readonly kind: 'public' | 'authenticated' | 'permission';
  readonly permissionName: string | null;
  readonly audit: boolean;
  readonly isSystem: true;
}

function toRow(policy: RouteAccessPolicy): RoutePolicyRow {
  if ('public' in policy && policy.public === true) {
    return { routeId: policy.routeId, kind: 'public', permissionName: null, audit: false, isSystem: true };
  }
  if ('authenticated' in policy && policy.authenticated === true) {
    return {
      routeId: policy.routeId,
      kind: 'authenticated',
      permissionName: null,
      audit: policy.audit === true,
      isSystem: true,
    };
  }
  if ('permission' in policy) {
    return {
      routeId: policy.routeId,
      kind: 'permission',
      permissionName: policy.permission,
      audit: policy.audit === true,
      isSystem: true,
    };
  }
  throw new Error(`Route policy "${policy.routeId}" has an unsupported shape.`);
}

/**
 * Reconcile code-declared route policies into the database on boot. Each route
 * the application declares gets a row with its code default; existing rows are
 * left untouched (`orIgnore`) so admin rebindings persist across restarts. This
 * makes the DB the authoritative, editable binding of route -> permission while
 * code remains the source of which routes exist.
 */
export async function reconcileRoutePolicies(
  dataSource: DataSource,
  policies: readonly RouteAccessPolicy[],
): Promise<void> {
  if (policies.length === 0) {
    return;
  }
  const rows = policies.map(toRow);
  await dataSource
    .getRepository(RoutePolicy)
    .createQueryBuilder()
    .insert()
    .values(rows)
    .orIgnore()
    .execute();
}
