import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { McpError } from '../errors';

/**
 * Inbound resource-server authentication for the DB MCP server. Validates the
 * caller's audience-restricted `client_credentials` token (full signature,
 * issuer, audience) and pins the authorized party (`azp`) so ONLY the SQL
 * analyst agent — never a user token, never another service — can reach the
 * data tools. Default deny: any failure throws and the request is rejected.
 */
export interface VerifiedCaller {
  /** Authorized party (calling client id), already checked against the allowlist. */
  readonly azp: string;
  /** Token subject (the service account), for audit only. */
  readonly subject: string;
}

export interface ResourceServerConfig {
  readonly issuerUrl: string;
  readonly jwksUri: string;
  readonly audience: string;
  readonly authorizedParties: readonly string[];
}

export class ResourceServer {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: ResourceServerConfig) {
    this.getKey = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(authorizationHeader: string | undefined): Promise<VerifiedCaller> {
    const token = this.extractBearer(authorizationHeader);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuerUrl,
        audience: this.config.audience,
        algorithms: ['RS256', 'ES256'],
      }));
    } catch {
      throw new McpError('unauthenticated', 'The provided token is invalid or expired.');
    }

    const azp = typeof payload['azp'] === 'string' ? payload['azp'] : undefined;
    if (!azp || !this.config.authorizedParties.includes(azp)) {
      throw new McpError('unauthenticated', 'The token was issued to an unauthorized party.');
    }
    const subject = typeof payload.sub === 'string' ? payload.sub : azp;
    return { azp, subject };
  }

  private extractBearer(header: string | undefined): string {
    if (!header || !header.startsWith('Bearer ')) {
      throw new McpError('unauthenticated', 'A bearer token is required.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new McpError('unauthenticated', 'A bearer token is required.');
    }
    return token;
  }
}
