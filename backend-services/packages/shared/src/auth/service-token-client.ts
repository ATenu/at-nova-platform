/**
 * Minimal, typed OAuth2 `client_credentials` token client with in-memory
 * caching. Used by Nova services to mint short-lived, audience-restricted
 * service tokens for service-to-service calls (e.g. nova-api -> nova-orchestrator).
 *
 * The acquired token is never logged or serialized. A single shared client
 * avoids a second bespoke token implementation per consumer.
 */

export interface ServiceTokenClientConfig {
  /** Full Keycloak token endpoint URL. */
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * Target audience name (e.g. ``nova-mcp-data``). When
   * ``requestAudienceScopes`` is true this is forwarded to the IdP as an OAuth
   * ``scope`` parameter. When false (default) the realm is expected to inject
   * the audience via a protocol mapper on the client instead.
   */
  readonly scope?: string;
  /** Forward ``scope`` to the IdP as an OAuth scope parameter. Default false. */
  readonly requestAudienceScopes?: boolean;
  /** Network timeout for the token request. */
  readonly requestTimeoutMs?: number;
  /** Refresh the cached token this many ms before its expiry. */
  readonly expirySkewMs?: number;
}

export class ServiceTokenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ServiceTokenError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXPIRY_SKEW_MS = 15_000;

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

export class ServiceTokenClient {
  private cached: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ServiceTokenClientConfig) {}

  /** Return a valid access token, reusing the cached one until near expiry. */
  async getToken(): Promise<string> {
    const now = Date.now();
    const skew = this.config.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
    if (this.cached && this.cached.expiresAt - skew > now) {
      return this.cached.value;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (this.config.scope && this.config.requestAudienceScopes) {
      body.set('scope', this.config.scope);
    }

    let response: Response;
    try {
      response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ServiceTokenError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Service token request timed out.'
          : 'Service token request failed.',
      );
    }

    if (!response.ok) {
      throw new ServiceTokenError('Failed to obtain a service token.', response.status);
    }

    const json = (await response.json()) as TokenResponse;
    if (!json.access_token) {
      throw new ServiceTokenError('Token response did not include an access token.');
    }

    this.cached = {
      value: json.access_token,
      expiresAt: now + (json.expires_in ?? 60) * 1000,
    };
    return json.access_token;
  }

  /** Drop the cached token (e.g. after a 401 from a downstream service). */
  invalidate(): void {
    this.cached = null;
  }
}
