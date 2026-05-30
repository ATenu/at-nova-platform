import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/auth.api';
import { queryKeys } from '@/api/queryClient';
import {
  hasAnyPermission,
  hasPermission,
  hasRole,
  type CurrentUser,
  type NovaPermission,
  type NovaRole,
} from './permissions';
import { session, setMockUser } from './session';
import { setTokenProvider } from './tokenBridge';
import { env } from '@/lib/env';

type SessionStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  readonly status: SessionStatus;
  readonly user: CurrentUser | null;
  readonly isLoadingUser: boolean;
  readonly userError: unknown;
  readonly useMocks: boolean;
  readonly login: () => void;
  readonly loginAsMockUser: (email: string) => void;
  readonly logout: () => void;
  readonly refetchUser: () => void;
  readonly can: (permission: NovaPermission) => boolean;
  readonly canAny: (permissions: readonly NovaPermission[]) => boolean;
  readonly is: (role: NovaRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('initializing');
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    setTokenProvider({
      getToken: () => session.getToken(),
      onUnauthorized: () => {
        if (!cancelled) {
          setStatus('unauthenticated');
        }
      },
    });
    session
      .init()
      .then((authenticated) => {
        if (!cancelled) {
          setStatus(authenticated ? 'authenticated' : 'unauthenticated');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const userQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getCurrentUser,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });

  const login = useCallback(() => {
    session.login();
  }, []);

  const loginAsMockUser = useCallback(
    (email: string) => {
      setMockUser(email);
      setStatus('authenticated');
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    queryClient.clear();
    session.logout();
  }, [queryClient]);

  const refetchUser = useCallback(() => {
    void userQuery.refetch();
  }, [userQuery]);

  const user = userQuery.data ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isLoadingUser: userQuery.isLoading,
      userError: userQuery.error,
      useMocks: env.useMocks,
      login,
      loginAsMockUser,
      logout,
      refetchUser,
      can: (permission) => hasPermission(user, permission),
      canAny: (permissions) => hasAnyPermission(user, permissions),
      is: (role) => hasRole(user, role),
    }),
    [status, user, userQuery.isLoading, userQuery.error, login, loginAsMockUser, logout, refetchUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
