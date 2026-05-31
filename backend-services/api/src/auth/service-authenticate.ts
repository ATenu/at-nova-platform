import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { ServiceTokenVerifier } from './service-token-verifier';

const BEARER_PREFIX = 'Bearer ';

/**
 * Authentication middleware for internal service-to-service endpoints (the MCP
 * tool gateway). Validates an audience-restricted `client_credentials` token via
 * {@link ServiceTokenVerifier}. It deliberately does NOT build a user
 * AuthContext — internal endpoints authorize from the run's entitlement
 * snapshot, never from claims trusted off the wire.
 */
export function createServiceAuthenticate(verifier: ServiceTokenVerifier): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      next(new UnauthenticatedError('A service token is required.'));
      return;
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      next(new UnauthenticatedError('A service token is required.'));
      return;
    }
    verifier
      .verify(token)
      .then(() => next())
      .catch(next);
  };
}
