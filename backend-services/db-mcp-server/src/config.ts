import { booleanFromEnv, csvFromEnv, loadConfig } from '@nova/shared';
import { z } from 'zod';

/**
 * Typed, validated configuration for the DB MCP server. Loaded once at startup;
 * the process refuses to boot with invalid configuration. No module reads
 * `process.env` directly. Secrets are never logged (the shared logger redacts).
 */
const mcpEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MCP_DATA_PORT: z.coerce.number().int().positive().default(8002),
  MCP_BODY_LIMIT: z.string().min(1).default('64kb'),
  MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MCP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Dedicated read-only connection (the `nova_mcp_readonly` role) — NEVER the
  // business AppDataSource credentials.
  MCP_READONLY_DATABASE_URL: z.string().url(),
  MCP_READONLY_DB_SSL: booleanFromEnv.default('false'),
  MCP_READONLY_POOL_MAX: z.coerce.number().int().positive().default(5),

  // Inbound auth: this resource server's audience + who may call it (azp).
  KEYCLOAK_ISSUER_URL: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url().optional(),
  MCP_DATA_AUDIENCE: z.string().min(1).default('nova-mcp-data'),
  MCP_DATA_AUTHORIZED_PARTIES: csvFromEnv.default('nova-agent-sql-analyst'),

  // Outbound: fetch the verified entitlement snapshot from the control plane
  // (decision D2). The MCP server mints its own client_credentials token.
  NOVA_API_INTERNAL_URL: z.string().url(),
  KEYCLOAK_TOKEN_URL: z.string().url().optional(),
  KEYCLOAK_REALM: z.string().min(1).default('nova'),
  MCP_DATA_CLIENT_ID: z.string().min(1).default('nova-mcp-data'),
  MCP_DATA_CLIENT_SECRET: z.string().min(1).optional(),
  // Audience the snapshot fetch token targets (the entitlement endpoint).
  ENTITLEMENT_AUDIENCE_SCOPE: z.string().min(1).default('nova-mcp-data'),

  // SQL-safety limits (§3.2).
  SQL_MAX_ROWS: z.coerce.number().int().positive().max(10_000).default(500),
  SQL_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SQL_MAX_RESULT_BYTES: z.coerce.number().int().positive().default(1_000_000),
});

export type RawMcpConfig = z.infer<typeof mcpEnvSchema>;

export interface McpConfig {
  readonly environment: RawMcpConfig['NODE_ENV'];
  readonly logLevel: RawMcpConfig['LOG_LEVEL'];
  readonly port: number;
  readonly bodyLimit: string;
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
  readonly db: {
    readonly url: string;
    readonly ssl: boolean;
    readonly poolMax: number;
  };
  readonly auth: {
    readonly issuerUrl: string;
    readonly jwksUri: string;
    readonly audience: string;
    readonly authorizedParties: readonly string[];
  };
  readonly controlPlane: {
    readonly baseUrl: string;
    readonly tokenUrl: string;
    readonly clientId: string;
    readonly clientSecret: string | null;
    readonly audienceScope: string;
  };
  readonly sql: {
    readonly maxRows: number;
    readonly statementTimeoutMs: number;
    readonly maxResultBytes: number;
  };
}

function deriveJwksUri(issuerUrl: string, explicit: string | undefined): string {
  if (explicit) {
    return explicit;
  }
  return `${issuerUrl.replace(/\/+$/, '')}/protocol/openid-connect/certs`;
}

function deriveTokenUrl(issuerUrl: string, explicit: string | undefined, realm: string): string {
  if (explicit) {
    return explicit;
  }
  const origin = new URL(issuerUrl).origin;
  return `${origin}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

export function loadMcpConfig(): McpConfig {
  const env = loadConfig(mcpEnvSchema);
  return {
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.MCP_DATA_PORT,
    bodyLimit: env.MCP_BODY_LIMIT,
    rateLimit: { windowMs: env.MCP_RATE_LIMIT_WINDOW_MS, max: env.MCP_RATE_LIMIT_MAX },
    db: {
      url: env.MCP_READONLY_DATABASE_URL,
      ssl: env.MCP_READONLY_DB_SSL,
      poolMax: env.MCP_READONLY_POOL_MAX,
    },
    auth: {
      issuerUrl: env.KEYCLOAK_ISSUER_URL,
      jwksUri: deriveJwksUri(env.KEYCLOAK_ISSUER_URL, env.KEYCLOAK_JWKS_URI),
      audience: env.MCP_DATA_AUDIENCE,
      authorizedParties: env.MCP_DATA_AUTHORIZED_PARTIES,
    },
    controlPlane: {
      baseUrl: env.NOVA_API_INTERNAL_URL.replace(/\/+$/, ''),
      tokenUrl: deriveTokenUrl(env.KEYCLOAK_ISSUER_URL, env.KEYCLOAK_TOKEN_URL, env.KEYCLOAK_REALM),
      clientId: env.MCP_DATA_CLIENT_ID,
      clientSecret: env.MCP_DATA_CLIENT_SECRET ?? null,
      audienceScope: env.ENTITLEMENT_AUDIENCE_SCOPE,
    },
    sql: {
      maxRows: env.SQL_MAX_ROWS,
      statementTimeoutMs: env.SQL_STATEMENT_TIMEOUT_MS,
      maxResultBytes: env.SQL_MAX_RESULT_BYTES,
    },
  };
}
