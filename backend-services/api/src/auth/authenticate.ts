import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import { buildAuthContext } from './auth-context';
import type { TokenVerifier } from './token-verifier';

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(header: string | undefined): string {
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthenticatedError('A bearer token is required.');
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new UnauthenticatedError('A bearer token is required.');
  }
  return token;
}

/**
 * Centralized authentication middleware. Validates the bearer token and
 * attaches a typed AuthContext. Applied to every protected route via the
 * `protectedRoute` composer.
 */
export function createAuthenticate(verifier: TokenVerifier): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);
    verifier
      .verify(token)
      .then((payload) => {
        req.auth = buildAuthContext(payload);
        next();
      })
      .catch(next);
  };
}
