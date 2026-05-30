import { Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { NovaPermission } from './permissions';
import { ForbiddenPage } from '@/features/misc/ForbiddenPage';

/**
 * Route guard that requires at least one of the given permissions. Renders a
 * clear forbidden page otherwise. The backend remains authoritative; this only
 * prevents users from landing on screens they cannot use.
 */
export function RequirePermission({ anyOf }: { anyOf: readonly NovaPermission[] }) {
  const { canAny } = useAuth();
  if (!canAny(anyOf)) {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}
