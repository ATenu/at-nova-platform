import { UnauthenticatedError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import type { UserRepository, UserWithRoles } from './user.repository';

function localPartOf(email: string | undefined): string {
  return email?.split('@')[0] ?? 'user';
}

/**
 * Resolve the authenticated principal's application profile, provisioning one
 * just-in-time on first login. Matching prefers the Keycloak id (`sub`) and
 * falls back to email so that realm-imported/seeded users link on first sign-in.
 *
 * Roles are seeded from the validated token only when a profile is first
 * created; thereafter role mappings are managed in the database and reconciled
 * to Keycloak by the admin flow. Authorization always uses the token's roles.
 */
export async function resolveCurrentUser(
  repository: UserRepository,
  auth: AuthContext,
): Promise<UserWithRoles> {
  if (!auth.subject) {
    throw new UnauthenticatedError('Token is missing a subject.');
  }

  const byKeycloak = await repository.findByKeycloakId(auth.subject);
  if (byKeycloak) {
    return byKeycloak;
  }

  if (auth.email) {
    const byEmail = await repository.findByEmail(auth.email);
    if (byEmail) {
      // Link the local profile to the Keycloak identity on first match.
      if (byEmail.user.keycloakId === null) {
        await repository.setKeycloakId(byEmail.user.id, auth.subject);
        byEmail.user.keycloakId = auth.subject;
      }
      return byEmail;
    }
  }

  if (!auth.email) {
    throw new UnauthenticatedError('Token is missing an email claim.');
  }

  const created = await repository.create({
    email: auth.email,
    firstName: auth.givenName ?? localPartOf(auth.email),
    lastName: auth.familyName ?? '',
    middleName: null,
    description: null,
    keycloakId: auth.subject,
    active: true,
  });
  const roles = [...auth.roles].sort();
  if (roles.length > 0) {
    await repository.replaceRoles(created.id, roles);
  }
  return { user: created, roles };
}
