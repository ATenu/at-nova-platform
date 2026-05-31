import { booleanFromEnv, csvFromEnv, loadConfig, redisUrlSchema } from '@nova/shared';
import { z } from 'zod';

/**
 * Typed, validated API configuration. Loaded once at startup; the process
 * refuses to boot with invalid configuration. No module reads `process.env`
 * directly.
 */
const apiEnvSchema = z
  .object({
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

    // Isolated orchestration-state DB (control plane writes runs + snapshots).
    // Optional: when absent, the agent-runs surface is not mounted.
    AGENTS_DATABASE_URL: z.string().url().optional(),
    AGENTS_DB_SSL: booleanFromEnv.default('false'),

    // Orchestrator task gateway. The API enqueues by ID only with an
    // audience-restricted (nova-orchestrator) service token. Optional: when
    // absent, submitted runs are persisted as `queued` but not dispatched.
    ORCHESTRATOR_BASE_URL: z.string().url().optional(),
    ORCHESTRATOR_AUDIENCE: z.string().min(1).default('nova-orchestrator'),
    AGENT_RUN_TTL_SECONDS: z.coerce.number().int().positive().default(7200),

    // Internal MCP tool gateway: callers reach it with an audience-restricted
    // (nova-mcp-*) service token whose authorized party (azp) must be in the
    // allowlist — the Celery worker and the SQL analyst agent (its authoritative
    // write path, decision D3). Authorization is re-enforced from the entitlement
    // snapshot, never from these claims.
    INTERNAL_TOOL_GATEWAY_AUDIENCE: z.string().min(1).default('nova-mcp-sales'),
    INTERNAL_TOOL_GATEWAY_AZP: csvFromEnv.default('nova-celery-worker,nova-agent-sql-analyst'),

    // Internal entitlement snapshot read-back endpoint (decision D2). The DB MCP
    // server and the `at-sql-analyser` agent fetch the verified snapshot for a
    // run from here to re-enforce authorization (call-back fetch). It has its
    // OWN narrower audience + azp allowlist so the read-only snapshot caller set
    // never widens the high-privilege capability-execution endpoints.
    INTERNAL_ENTITLEMENT_AUDIENCE: z.string().min(1).default('nova-mcp-data'),
    INTERNAL_ENTITLEMENT_AZP: csvFromEnv.default('nova-agent-sql-analyst,nova-mcp-data'),

    // Shared cache / rate-limit Redis (frontend+backend instance). Optional in
    // dev/test (falls back to an in-memory limiter), required in production so
    // limits are correct across replicas. Use `rediss://` (TLS) for any managed
    // endpoint; `redis://` only over a trusted private network.
    REDIS_CACHE_URL: redisUrlSchema.optional(),
    // When the rate-limit store is unreachable, allow requests through rather
    // than 5xx-ing every request. Rate limiting is an availability control, not
    // an authorization control (authz stays JWT + RBAC), so failing open is the
    // safe default; set to `false` to fail closed.
    REDIS_RATE_LIMIT_FAIL_OPEN: booleanFromEnv.default('true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.REDIS_CACHE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_CACHE_URL'],
        message: 'is required in production (shared rate-limit store across replicas)',
      });
    }
  });

export type RawApiConfig = z.infer<typeof apiEnvSchema>;

export interface ApiConfig {
  readonly environment: RawApiConfig['NODE_ENV'];
  readonly logLevel: RawApiConfig['LOG_LEVEL'];
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly bodyLimit: string;
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
  /**
   * Redis-backed shared state. `cacheUrl` is `null` when no cache instance is
   * configured (dev/test), in which case the rate limiter falls back to an
   * in-memory store that is NOT shared across replicas.
   */
  readonly redis: {
    readonly cacheUrl: string | null;
    readonly rateLimitFailOpen: boolean;
  };
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
  /**
   * Orchestration plane. `agents.databaseUrl` is `null` when the isolated
   * orchestration DB is not configured (the agent-runs API is then not mounted).
   * `orchestrator.baseUrl` is `null` when no task gateway is configured (runs are
   * persisted as `queued` but not dispatched from the API).
   */
  readonly agents: {
    readonly databaseUrl: string | null;
    readonly dbSsl: boolean;
    readonly runTtlSeconds: number;
  };
  readonly orchestrator: {
    readonly baseUrl: string | null;
    readonly audience: string;
    readonly tokenUrl: string;
  };
  /** Internal MCP tool gateway: who may call it (audience + authorized parties). */
  readonly toolGateway: {
    readonly audience: string;
    readonly authorizedParties: readonly string[];
  };
  /** Internal entitlement read-back endpoint: its own narrower caller allowlist. */
  readonly entitlementEndpoint: {
    readonly audience: string;
    readonly authorizedParties: readonly string[];
  };
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
  // The service-token endpoint is reached internally (same origin as the JWKS).
  const tokenUrl = `${originOf(jwksUri)}/realms/${encodeURIComponent(env.KEYCLOAK_REALM)}/protocol/openid-connect/token`;
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.API_PORT,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    bodyLimit: env.API_BODY_LIMIT,
    rateLimit: { windowMs: env.API_RATE_LIMIT_WINDOW_MS, max: env.API_RATE_LIMIT_MAX },
    redis: {
      cacheUrl: env.REDIS_CACHE_URL ?? null,
      rateLimitFailOpen: env.REDIS_RATE_LIMIT_FAIL_OPEN,
    },
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
    agents: {
      databaseUrl: env.AGENTS_DATABASE_URL ?? null,
      dbSsl: env.AGENTS_DB_SSL,
      runTtlSeconds: env.AGENT_RUN_TTL_SECONDS,
    },
    orchestrator: {
      baseUrl: env.ORCHESTRATOR_BASE_URL ?? null,
      audience: env.ORCHESTRATOR_AUDIENCE,
      tokenUrl,
    },
    toolGateway: {
      audience: env.INTERNAL_TOOL_GATEWAY_AUDIENCE,
      authorizedParties: env.INTERNAL_TOOL_GATEWAY_AZP,
    },
    entitlementEndpoint: {
      audience: env.INTERNAL_ENTITLEMENT_AUDIENCE,
      authorizedParties: env.INTERNAL_ENTITLEMENT_AZP,
    },
  };
}
