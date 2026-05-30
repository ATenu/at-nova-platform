import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthenticatedError, permissionsForRoles } from '@nova/shared';
import { authorize } from './authorize';
import type { RouteAccessPolicy } from './route-policy';
import type { AuthContext } from './auth-context';

function runAuthorize(policy: RouteAccessPolicy, auth?: AuthContext): Error | undefined {
  let captured: Error | undefined;
  const next: NextFunction = (err?: unknown) => {
    captured = err instanceof Error ? err : undefined;
  };
  const req = { auth, log: undefined } as unknown as Request;
  const res = {} as Response;
  authorize(policy)(req, res, next);
  return captured;
}

function authForRoles(roles: AuthContext['roles']): AuthContext {
  return {
    subject: 'user-123',
    issuer: 'https://keycloak.local/realms/nova',
    audience: ['nova-api'],
    email: 'user@test.com',
    username: 'user',
    givenName: 'Test',
    familyName: 'User',
    roles,
    permissions: permissionsForRoles(roles),
    scopes: [],
  };
}

describe('authorize middleware (authz matrix)', () => {
  const protectedPolicy: RouteAccessPolicy = {
    routeId: 'test.protected',
    permission: 'read-customers',
  };
  const publicPolicy: RouteAccessPolicy = { routeId: 'test.public', public: true };
  const authenticatedPolicy: RouteAccessPolicy = {
    routeId: 'test.authenticated',
    authenticated: true,
  };

  it('allows public routes without authentication', () => {
    expect(runAuthorize(publicPolicy)).toBeUndefined();
  });

  it('rejects authenticated-only routes with no auth context (401)', () => {
    expect(runAuthorize(authenticatedPolicy)).toBeInstanceOf(UnauthenticatedError);
  });

  it('allows authenticated-only routes for any authenticated principal', () => {
    expect(runAuthorize(authenticatedPolicy, authForRoles(['ops-compliance']))).toBeUndefined();
  });

  it('rejects protected routes with no auth context (401)', () => {
    expect(runAuthorize(protectedPolicy)).toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a token missing the required permission (403)', () => {
    expect(runAuthorize(protectedPolicy, authForRoles(['ops-compliance']))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('allows a token with the required permission', () => {
    expect(runAuthorize(protectedPolicy, authForRoles(['sales-user']))).toBeUndefined();
  });
});
