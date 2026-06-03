import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRbacRegistry } from '@/api/rbac.api';
import type { CapabilityDto, PermissionDto, RoleDto, RoutePolicyDto, ViewPermissionDto } from '@/api/types';
import { useAuth } from './AuthProvider';

interface RbacRegistryValue {
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly revision: number;
  readonly roles: readonly RoleDto[];
  readonly permissions: readonly PermissionDto[];
  readonly rolePermissions: Record<string, readonly string[]>;
  readonly capabilities: readonly CapabilityDto[];
  readonly routePolicies: readonly RoutePolicyDto[];
  readonly viewPermissions: readonly ViewPermissionDto[];
  /** Required permission for a backend routeId (DB-driven), if any. */
  readonly requiredPermissionForRoute: (routeId: string) => string | null;
  readonly refetch: () => void;
}

const EMPTY: RbacRegistryValue = {
  isLoading: true,
  error: null,
  revision: 0,
  roles: [],
  permissions: [],
  rolePermissions: {},
  capabilities: [],
  routePolicies: [],
  viewPermissions: [],
  requiredPermissionForRoute: () => null,
  refetch: () => {},
};

const RbacRegistryContext = createContext<RbacRegistryValue>(EMPTY);

/**
 * Fetches the effective authorization policy (`GET /rbac/registry`) once the
 * user is authenticated and exposes it to the app. This is the single dynamic
 * source for role/permission pickers, the editable grant matrix, and the
 * capability policy editor. It is advisory for the UI; the backend enforces.
 */
export function RbacRegistryProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  const query = useQuery({
    queryKey: ['rbac', 'registry'],
    queryFn: getRbacRegistry,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });

  const value = useMemo<RbacRegistryValue>(() => {
    const data = query.data;
    const routePolicyMap = new Map((data?.routePolicies ?? []).map((policy) => [policy.routeId, policy]));
    return {
      isLoading: query.isLoading,
      error: query.error,
      revision: data?.revision ?? 0,
      roles: data?.roles ?? [],
      permissions: data?.permissions ?? [],
      rolePermissions: data?.rolePermissions ?? {},
      capabilities: data?.capabilities ?? [],
      routePolicies: data?.routePolicies ?? [],
      viewPermissions: data?.viewPermissions ?? [],
      requiredPermissionForRoute: (routeId) => {
        const policy = routePolicyMap.get(routeId);
        return policy?.kind === 'permission' ? (policy.permissionName ?? null) : null;
      },
      refetch: () => void query.refetch(),
    };
  }, [query.data, query.isLoading, query.error, query.refetch]);

  return <RbacRegistryContext.Provider value={value}>{children}</RbacRegistryContext.Provider>;
}

export function useRbacRegistry(): RbacRegistryValue {
  return useContext(RbacRegistryContext);
}
