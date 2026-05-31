import { Pool, type PoolConfig } from 'pg';
import { McpError } from '../errors';

/**
 * Dedicated read-only connection pool for the MCP data tools. Connects as the
 * least-privileged `nova_mcp_readonly` role (SELECT only, on `mcp_read` views),
 * so even a hypothetical SQL-validator bypass cannot mutate data or read base
 * tables. Every query runs inside a READ ONLY transaction with:
 *
 *   - a hard `statement_timeout` (caps runaway scans),
 *   - the per-session `nova.owner_subject` GUC set from the verified snapshot
 *     (drives owner-scoped views' row filtering), and
 *   - parameterized values only (no string interpolation of user data).
 */
export interface ReadOnlyQueryOptions {
  readonly ownerSubject: string;
  readonly statementTimeoutMs: number;
}

export class ReadOnlyDataSource {
  private readonly pool: Pool;

  constructor(config: { url: string; ssl: boolean; poolMax: number }) {
    const poolConfig: PoolConfig = {
      connectionString: config.url,
      max: config.poolMax,
      ...(config.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
      // Belt-and-braces: the role is also configured read-only in the DB.
      application_name: 'nova-db-mcp-server',
    };
    this.pool = new Pool(poolConfig);
  }

  async runSelect(
    sql: string,
    params: readonly unknown[],
    options: ReadOnlyQueryOptions,
  ): Promise<Record<string, unknown>[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      // Parameterize GUCs via set_config so neither the timeout nor the owner
      // subject is ever string-concatenated into SQL. `is_local = true` scopes
      // them to this transaction.
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(options.statementTimeoutMs),
      ]);
      await client.query("SELECT set_config('nova.owner_subject', $1, true)", [
        options.ownerSubject,
      ]);
      const result = await client.query(sql, params as unknown[]);
      await client.query('COMMIT');
      return result.rows as Record<string, unknown>[];
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failures; the connection is released below
      }
      throw this.toQueryError(error);
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private toQueryError(error: unknown): McpError {
    // Postgres statement_timeout surfaces as code 57014.
    const code = (error as { code?: string } | null)?.code;
    if (code === '57014') {
      return new McpError('sql_rejected', 'The query exceeded the time limit.');
    }
    // Never leak the raw driver message (may echo SQL/identifiers).
    return new McpError('sql_rejected', 'The query could not be executed.');
  }
}
