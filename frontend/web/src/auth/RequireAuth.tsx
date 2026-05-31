import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { FullScreenState } from '@/components/layout/FullScreenState';

/**
 * Gate for all authenticated routes. While the session initializes or the user
 * profile loads we show a full-screen loader. Unauthenticated users are sent to
 * Keycloak (real) or the local login picker (mock). This is a UX gate only —
 * the backend independently authorizes every request.
 */
export function RequireAuth() {
  const { status, user, isLoadingUser, userError, refetchUser } = useAuth();
  const location = useLocation();

  if (status === 'initializing') {
    return <FullScreenState variant="loading" message="Starting Nova…" />;
  }

  if (status === 'error') {
    return (
      <FullScreenState
        variant="error"
        title="Sign-in unavailable"
        message="We could not reach the authentication service. Please try again shortly."
      />
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (isLoadingUser) {
    return <FullScreenState variant="loading" message="Loading your workspace…" />;
  }

  if (userError || !user) {
    return (
      <FullScreenState
        variant="error"
        title="Could not load your profile"
        message="Your session is valid but we couldn't load your account from Nova."
        onRetry={refetchUser}
      />
    );
  }

  return <Outlet />;
}
