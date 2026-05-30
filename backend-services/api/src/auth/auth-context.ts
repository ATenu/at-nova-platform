import type { Role, Permission } from '@nova/shared';
import { permissionsForRoles, toKnownRoles } from '@nova/shared';
import type { JWTPayload } from 'jose';

/**
 * Normalized, typed representation of the authenticated principal. Built once
 * from a fully validated token and carried through the request. Feature code
 * reads this instead of touching raw claims.
 */
export interface AuthContext {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly email: string | undefined;
  readonly username: string | undefined;
  readonly givenName: string | undefined;
  readonly familyName: string | undefined;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
  readonly scopes: readonly string[];
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
  const roles = toKnownRoles(extractRealmRoles(payload));
  return {
    subject: payload.sub ?? '',
    issuer: payload.iss ?? '',
    audience: asAudience(payload.aud),
    email: asString(payload['email']),
    username: asString(payload['preferred_username']),
    givenName: asString(payload['given_name']),
    familyName: asString(payload['family_name']),
    roles,
    permissions: permissionsForRoles(roles),
    scopes: extractScopes(payload),
  };
}
