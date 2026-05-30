import { http } from './httpClient';
import type { CurrentUser } from '@/auth/permissions';

/**
 * Fetch the current application user profile, including the effective roles and
 * permissions resolved by the backend from the database. This — not the token
 * claims — is the authoritative source for UI affordances.
 *
 * Backed by `GET /auth/me`. In dev mock mode an equivalent in-browser response
 * is served; the production build always calls the real API.
 */
export function getCurrentUser(): Promise<CurrentUser> {
  return http.get<CurrentUser>('/auth/me');
}
