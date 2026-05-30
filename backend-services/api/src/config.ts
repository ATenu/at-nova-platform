import { booleanFromEnv, csvFromEnv, loadConfig } from '@nova/shared';
import { z } from 'zod';

/**
 * Typed, validated API configuration. Loaded once at startup; the process
 * refuses to boot with invalid configuration. No module reads `process.env`
 * directly.
 */
const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ALLOWED_ORIGINS: csvFromEnv.default('http://localhost:3000'),
  API_BODY_LIMIT: z.string().min(1).default('100kb'),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  KEYCLOAK_ISSUER_URL: z.string().url(),
  KEYCLOAK_AUDIENCE: csvFromEnv,
  KEYCLOAK_JWKS_URI: z.string().url().optional(),

  // Keycloak Admin REST integration (server-to-server, client_credentials).
  // Provisioning is enabled only when a client secret is configured.
  KEYCLOAK_REALM: z.string().min(1).default('nova'),
  KEYCLOAK_ADMIN_BASE_URL: z.string().url().optional(),
  KEYCLOAK_API_CLIENT_ID: z.string().min(1).default('nova-api'),
  KEYCLOAK_API_CLIENT_SECRET: z.string().min(1).optional(),

  DB_SSL: booleanFromEnv.default('false'),
});

export type RawApiConfig = z.infer<typeof apiEnvSchema>;

export interface ApiConfig {
  readonly environment: RawApiConfig['NODE_ENV'];
  readonly logLevel: RawApiConfig['LOG_LEVEL'];
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly bodyLimit: string;
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
  readonly auth: {
    readonly issuerUrl: string;
    readonly audience: readonly string[];
    readonly jwksUri: string;
  };
  /**
   * Keycloak Admin REST configuration for backend-driven user provisioning.
   * `null` when no client secret is configured (provisioning disabled; the API
   * still manages local profiles and reports an un-provisioned sync status).
   */
  readonly keycloakAdmin: {
    readonly baseUrl: string;
    readonly realm: string;
    readonly clientId: string;
    readonly clientSecret: string;
  } | null;
}

function deriveJwksUri(issuerUrl: string, explicit: string | undefined): string {
  if (explicit) {
    return explicit;
  }
  const normalized = issuerUrl.replace(/\/+$/, '');
  return `${normalized}/protocol/openid-connect/certs`;
}

/** Origin (scheme://host:port) of a URL, used to reach Keycloak internally. */
function originOf(url: string): string {
  return new URL(url).origin;
}

export function loadApiConfig(): ApiConfig {
  const env = loadConfig(apiEnvSchema);
  const jwksUri = deriveJwksUri(env.KEYCLOAK_ISSUER_URL, env.KEYCLOAK_JWKS_URI);
  // Reach Keycloak's Admin REST API on the same origin the JWKS is fetched from
  // (internally reachable in Docker), unless an explicit base URL is provided.
  const adminBaseUrl = env.KEYCLOAK_ADMIN_BASE_URL ?? originOf(jwksUri);
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.API_PORT,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    bodyLimit: env.API_BODY_LIMIT,
    rateLimit: { windowMs: env.API_RATE_LIMIT_WINDOW_MS, max: env.API_RATE_LIMIT_MAX },
    auth: {
      issuerUrl: env.KEYCLOAK_ISSUER_URL,
      audience: env.KEYCLOAK_AUDIENCE,
      jwksUri,
    },
    keycloakAdmin: env.KEYCLOAK_API_CLIENT_SECRET
      ? {
          baseUrl: adminBaseUrl,
          realm: env.KEYCLOAK_REALM,
          clientId: env.KEYCLOAK_API_CLIENT_ID,
          clientSecret: env.KEYCLOAK_API_CLIENT_SECRET,
        }
      : null,
  };
}
