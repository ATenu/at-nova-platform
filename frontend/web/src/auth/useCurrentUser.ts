import { useAuth } from './AuthProvider';
import type { CurrentUser } from './permissions';

/** Convenience accessor for the authenticated application user (or null). */
export function useCurrentUser(): CurrentUser | null {
  return useAuth().user;
}
