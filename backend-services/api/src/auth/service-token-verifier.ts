import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { UnauthenticatedError } from '@nova/shared';

export interface ServiceTokenVerifierConfig {
  readonly issuerUrl: string;
  readonly jwksUri: string;
  /** Required audience(s); the token must carry at least one of these. */
  readonly audience: readonly string[];
  /**
   * Allowed authorized parties (`azp`) — the calling service's client id. A
   * valid Nova service token only proves "a trusted Nova service is calling";
   * pinning `azp` ensures only the intended service (e.g. the Celery worker)
   * reaches the internal tool gateway.
   */
  readonly authorizedParties: readonly string[];
}

/**
 * Verifies inbound service-to-service tokens for internal endpoints (the MCP
 * tool gateway). Distinct from {@link TokenVerifier} (user tokens, `aud:
 * nova-api`): this validates an audience-restricted `client_credentials` token
 * (e.g. `aud: nova-mcp-sales`, `azp: nova-celery-worker`), so a user token can
 * never reach internal capability execution and vice versa.
 */
export class ServiceTokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: ServiceTokenVerifierConfig) {
    this.getKey = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<JWTPayload> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuerUrl,
        audience: [...this.config.audience],
        algorithms: ['RS256', 'ES256'],
      }));
    } catch {
      throw new UnauthenticatedError('The provided service token is invalid or expired.');
    }

    const azp = typeof payload['azp'] === 'string' ? payload['azp'] : undefined;
    if (!azp || !this.config.authorizedParties.includes(azp)) {
      throw new UnauthenticatedError('The service token was issued to an unauthorized party.');
    }
    return payload;
  }
}
