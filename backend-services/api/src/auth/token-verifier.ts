import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { UnauthenticatedError } from '@nova/shared';
import type { ApiConfig } from '../config';

/**
 * Centralized bearer-token verification against the Keycloak JWKS.
 *
 * Validates signature, issuer, audience, and expiry/nbf (enforced by `jose`).
 * The JWKS is fetched lazily and cached with rotation handling by `jose`. This
 * is the only place tokens are verified; never decode a JWT elsewhere for
 * authorization decisions.
 */
export class TokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: ApiConfig['auth']) {
    this.getKey = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuerUrl,
        audience: [...this.config.audience],
        // Reject "alg: none" and unexpected algorithms; only allow RS256/ES256.
        algorithms: ['RS256', 'ES256'],
      });
      return payload;
    } catch {
      // Do not leak the underlying verification reason to the caller.
      throw new UnauthenticatedError('The provided token is invalid or expired.');
    }
  }
}
