import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import type { NovaPermission } from '@/auth/permissions';

/**
 * Conditionally render UI (buttons, columns, links) based on the current user's
 * effective permissions. Usability only — never a security control.
 */
export function PermissionGate({
  anyOf,
  fallback = null,
  children,
}: {
  anyOf: readonly NovaPermission[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { canAny } = useAuth();
  return <>{canAny(anyOf) ? children : fallback}</>;
}
