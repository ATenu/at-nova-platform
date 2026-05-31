import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Import from the `zod/v3` subpath so the schema types match the MCP SDK's
// zod-compat layer (it references `zod/v3`); using the `zod` main export yields
// a distinct type identity and breaks `registerTool`'s generic constraints.
import { z } from 'zod/v3';
import type { Logger } from '@nova/shared';
import { Auditor, hashSql } from '../audit/audit';
import type { ReadOnlyDataSource } from '../data/readonly-datasource';
import { describeSchema, listViews } from '../schema/describe-schema';
import { authorizeCapability, isEntitled } from '../auth/authorize';
import type { VerifiedCaller } from '../auth/resource-server';
import type { VerifiedSnapshot } from '../auth/snapshot-client';
import { validateSelect, type ParseFn } from '../sql/validate-select';
import { clampSelectToLimit, capResultBytes } from '../sql/limits';
import { redactRows, redactedColumnNames } from '../sql/redact';
import { McpError, toSafeError } from '../errors';

const DESCRIBE_CAPABILITY = 'data.schema.describe';
const SELECT_CAPABILITY = 'data.query.select';

/** Per-request execution context, bound to one verified caller + snapshot. */
export interface ToolContext {
  readonly snapshot: VerifiedSnapshot;
  readonly caller: VerifiedCaller;
  readonly dataSource: ReadOnlyDataSource;
  readonly logger: Logger;
  readonly sql: { readonly maxRows: number; readonly statementTimeoutMs: number; readonly maxResultBytes: number };
  /** Injectable parser for tests. */
  readonly parseFn?: ParseFn;
}

const selectParam = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Args schema for `run_select_query`. Re-validated inside the handler (defense
 * in depth) and exposed to the planner via `inputSchema`. Typed as a plain
 * `ZodRawShape` at the registration site to keep the SDK's tool generics from
 * deeply inferring the union (which trips TS2589).
 */
const runSelectArgs = z.object({
  sql: z.string().min(1).max(20_000),
  params: z.array(selectParam).max(64).optional(),
});

// Advertised input schema (for the planner). Kept intentionally shallow so the
// SDK's tool generics don't deeply instantiate the scalar union (TS2589); the
// handler re-validates against the strict `runSelectArgs` schema at runtime.
const runSelectInputSchema = {
  sql: z.string().min(1).max(20_000).describe('A single read-only SELECT statement.'),
  params: z.array(z.unknown()).optional().describe('Values for $1..$n placeholders (scalars only).'),
} satisfies z.ZodRawShape;

/**
 * Register the data tools onto an MCP server for one request. Tools the caller
 * is NOT entitled to are never registered, so `tools/list` already reflects the
 * entitlement (Layer A). Each handler independently re-enforces the capability
 * gate (Layer B) and emits an audit record. Handlers never throw raw errors to
 * the transport: failures map to a safe `isError` result.
 */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const auditor = new Auditor(ctx.logger);

  if (isEntitled(ctx.snapshot, DESCRIBE_CAPABILITY)) {
    server.registerTool(
      'describe_schema',
      {
        title: 'Describe the queryable data schema',
        description:
          'Return the curated, PII-aware read-only views (mcp_read.*) with columns and types. ' +
          'These are the ONLY relations that run_select_query may reference.',
        inputSchema: {},
      },
      () =>
        guard('describe_schema', ctx, auditor, DESCRIBE_CAPABILITY, () => {
          authorizeCapability(ctx.snapshot, DESCRIBE_CAPABILITY);
          const views = describeSchema();
          auditor.record({
            runId: ctx.snapshot.runId,
            ownerSubject: ctx.snapshot.ownerSubject,
            caller: ctx.caller.azp,
            capability: DESCRIBE_CAPABILITY,
            decision: 'allow',
          });
          return { views, redactedColumns: redactedColumnNames() };
        }),
    );

    server.registerTool(
      'list_views',
      {
        title: 'List the queryable views',
        description: 'Return the names and descriptions of the allowlisted mcp_read views.',
        inputSchema: {},
      },
      () =>
        guard('list_views', ctx, auditor, DESCRIBE_CAPABILITY, () => {
          authorizeCapability(ctx.snapshot, DESCRIBE_CAPABILITY);
          const views = listViews();
          auditor.record({
            runId: ctx.snapshot.runId,
            ownerSubject: ctx.snapshot.ownerSubject,
            caller: ctx.caller.azp,
            capability: DESCRIBE_CAPABILITY,
            decision: 'allow',
          });
          return { views };
        }),
    );
  }

  if (isEntitled(ctx.snapshot, SELECT_CAPABILITY)) {
    server.registerTool(
      'run_select_query',
      {
        title: 'Run a read-only SELECT',
        description:
          'Execute a single read-only SELECT against the mcp_read views. The query is parsed and ' +
          'validated (single SELECT, allowlisted relations only, no DML/DDL/locks/dangerous functions), ' +
          'capped by row and byte limits, run as a least-privileged read-only role, and PII columns are ' +
          'masked. Use parameterized placeholders ($1, $2, ...) and supply values in "params".',
        inputSchema: runSelectInputSchema,
      },
      (rawArgs) =>
        guard('run_select_query', ctx, auditor, SELECT_CAPABILITY, async () => {
          authorizeCapability(ctx.snapshot, SELECT_CAPABILITY);

          const args = runSelectArgs.parse(rawArgs);
          const started = Date.now();
          let validated;
          try {
            validated = await validateSelect(args.sql, ctx.parseFn);
          } catch (error) {
            auditor.record({
              runId: ctx.snapshot.runId,
              ownerSubject: ctx.snapshot.ownerSubject,
              caller: ctx.caller.azp,
              capability: SELECT_CAPABILITY,
              decision: 'deny',
              reason: 'sql_rejected',
            });
            throw error instanceof McpError
              ? error
              : new McpError('sql_rejected', 'The query was rejected by the SQL safety check.');
          }

          const capped = clampSelectToLimit(args.sql, ctx.sql.maxRows);
          const rawRows = await ctx.dataSource.runSelect(capped, args.params ?? [], {
            ownerSubject: ctx.snapshot.ownerSubject,
            statementTimeoutMs: ctx.sql.statementTimeoutMs,
          });
          const redacted = redactRows(rawRows);
          const { rows, truncated } = capResultBytes(redacted, ctx.sql.maxResultBytes);

          auditor.record({
            runId: ctx.snapshot.runId,
            ownerSubject: ctx.snapshot.ownerSubject,
            caller: ctx.caller.azp,
            capability: SELECT_CAPABILITY,
            decision: 'allow',
            relations: validated.relations,
            rowCount: rows.length,
            truncated,
            durationMs: Date.now() - started,
          });

          return {
            sqlHash: hashSql(args.sql),
            relations: validated.relations,
            rowCount: rows.length,
            truncated,
            rows,
          };
        }),
    );
  }
}

/** Wrap a handler body so any failure becomes a safe MCP error result. */
async function guard(
  tool: string,
  ctx: ToolContext,
  auditor: Auditor,
  capability: string,
  body: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<{ content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }> {
  try {
    const result = await body();
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const safe = toSafeError(error);
    if (safe.code === 'forbidden' || safe.code === 'unauthenticated') {
      auditor.record({
        runId: ctx.snapshot.runId,
        ownerSubject: ctx.snapshot.ownerSubject,
        caller: ctx.caller.azp,
        capability,
        decision: 'deny',
        reason: safe.code,
      });
    }
    ctx.logger.warn({ tool, code: safe.code }, 'mcp.tool.error');
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: safe.code, message: safe.message }) }],
      isError: true,
    };
  }
}
