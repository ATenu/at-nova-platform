import type { JWTPayload } from 'jose';
import { getActiveRegistry } from '../rbac/registry-holder';

/**
 * Normalized, typed representation of the authenticated principal. Built once
 * from a fully validated token and carried through the request. Feature code
 * reads this instead of touching raw claims.
 *
 * Roles are the realm roles from the token that are known to the platform's
 * DB-driven RBAC registry; permissions are resolved from those roles through the
 * same registry the authorization layer enforces. Both are plain strings because
 * roles and permissions are now admin-authorable at runtime (default deny: an
 * unknown role grants nothing).
 */
export interface AuthContext {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly email: string | undefined;
  readonly username: string | undefined;
  readonly givenName: string | undefined;
  readonly familyName: string | undefined;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly scopes: readonly string[];
  /**
   * Application user id pinned by an agent-run entitlement snapshot. Set only on
   * the execution plane when reconstructing auth from the snapshot; HTTP routes
   * resolve the user from validated token claims instead.
   */
  readonly applicationUserId?: string;
}

interface KeycloakRealmAccess {
  readonly roles?: unknown;
}

function extractRealmRoles(payload: JWTPayload): string[] {
  const realmAccess = payload['realm_access'];
  if (typeof realmAccess !== 'object' || realmAccess === null) {
    return [];
  }
  const roles = (realmAccess as KeycloakRealmAccess).roles;
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles.filter((role): role is string => typeof role === 'string');
}

function extractScopes(payload: JWTPayload): string[] {
  const scope = payload['scope'];
  if (typeof scope !== 'string') {
    return [];
  }
  return scope.split(' ').filter((entry) => entry.length > 0);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asAudience(value: JWTPayload['aud']): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

/** Build a typed AuthContext from a verified token payload. */
export function buildAuthContext(payload: JWTPayload): AuthContext {
  const registry = getActiveRegistry();
  const roles = registry.knownRoles(extractRealmRoles(payload));
  return {
    subject: payload.sub ?? '',
    issuer: payload.iss ?? '',
    audience: asAudience(payload.aud),
    email: asString(payload['email']),
    username: asString(payload['preferred_username']),
    givenName: asString(payload['given_name']),
    familyName: asString(payload['family_name']),
    roles,
    permissions: registry.permissionsForRoles(roles),
    scopes: extractScopes(payload),
  };
}
