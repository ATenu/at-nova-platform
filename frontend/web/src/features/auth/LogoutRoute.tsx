import { useEffect } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { FullScreenState } from '@/components/layout/FullScreenState';

export function LogoutRoute() {
  const { logout } = useAuth();
  useEffect(() => {
    logout();
  }, [logout]);
  return <FullScreenState variant="loading" message="Signing you out…" />;
}
