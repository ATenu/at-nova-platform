import { parse as parseSql } from 'pgsql-parser';
import { isAllowedRelation, MCP_READ_SCHEMA } from '../data/views';

/**
 * Fail-closed SQL-safety pipeline for `run_select_query` (sqlAnalystAgentPlan
 * §3.2). The query is parsed with a REAL parser (libpg_query via pgsql-parser),
 * then statically validated against an allowlist. Nothing about this relies on
 * string matching; the structure of the parse tree is authoritative.
 *
 * Rejects (default deny):
 *  - anything that is not exactly one `SelectStmt`;
 *  - any DML/DDL/utility/transaction statement anywhere (incl. inside CTEs);
 *  - `SELECT ... INTO`, locking clauses (`FOR UPDATE/SHARE`);
 *  - any relation not resolving to an allowlisted `mcp_read` view (so
 *    `pg_catalog`/`information_schema`/base tables are unreachable);
 *  - dangerous / side-effecting function calls (e.g. `pg_sleep`, `set_config`,
 *    file/large-object/dblink functions).
 */

export class SqlValidationError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'SqlValidationError';
  }
}

export interface ValidatedSelect {
  /** Allowlisted `mcp_read` view names referenced by the query. */
  readonly relations: readonly string[];
}

export type ParseFn = (sql: string) => Promise<unknown>;

// Statement node types that must never appear anywhere in the tree.
const FORBIDDEN_NODE_TYPES: ReadonlySet<string> = new Set([
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'MergeStmt',
  'CreateStmt',
  'CreateTableAsStmt',
  'CreateSeqStmt',
  'CreateFunctionStmt',
  'CreateRoleStmt',
  'CreatedbStmt',
  'CreateSchemaStmt',
  'AlterTableStmt',
  'AlterRoleStmt',
  'AlterDatabaseStmt',
  'DropStmt',
  'DropRoleStmt',
  'DropdbStmt',
  'TruncateStmt',
  'CopyStmt',
  'GrantStmt',
  'GrantRoleStmt',
  'VariableSetStmt',
  'VariableShowStmt',
  'TransactionStmt',
  'LockStmt',
  'DoStmt',
  'ExplainStmt',
  'ExecuteStmt',
  'PrepareStmt',
  'RefreshMatViewStmt',
  'ViewStmt',
  'RuleStmt',
  'NotifyStmt',
  'ListenStmt',
  'CallStmt',
]);

// Side-effecting / sensitive functions denied regardless of read-only role.
const FORBIDDEN_FUNCTIONS: ReadonlySet<string> = new Set([
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'set_config',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'lo_get',
  'lo_put',
  'dblink',
  'dblink_exec',
  'dblink_connect',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'query_to_xml',
  'pg_logical_emit_message',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Extract the dotted lower-cased name from a FuncCall `funcname` String list. */
function funcCallName(funcCall: Record<string, unknown>): string {
  const parts = funcCall['funcname'];
  if (!Array.isArray(parts)) {
    return '';
  }
  const names: string[] = [];
  for (const part of parts) {
    if (isRecord(part) && isRecord(part['String']) && typeof part['String']['sval'] === 'string') {
      names.push(part['String']['sval'].toLowerCase());
    }
  }
  return names.join('.');
}

/**
 * Validate an already-parsed libpg_query tree (pure, synchronous, testable).
 * Throws {@link SqlValidationError} on the first violation (fail closed).
 */
export function validateParsedSelect(parseResult: unknown): ValidatedSelect {
  if (!isRecord(parseResult) || !Array.isArray(parseResult['stmts'])) {
    throw new SqlValidationError('Query could not be parsed.', 'unparsable');
  }
  const stmts = parseResult['stmts'] as unknown[];
  if (stmts.length !== 1) {
    throw new SqlValidationError('Exactly one statement is allowed.', 'multiple_statements');
  }
  const wrapper = stmts[0];
  if (!isRecord(wrapper) || !isRecord(wrapper['stmt'])) {
    throw new SqlValidationError('Query could not be parsed.', 'unparsable');
  }
  const stmt = wrapper['stmt'];
  const stmtKeys = Object.keys(stmt);
  if (stmtKeys.length !== 1 || stmtKeys[0] !== 'SelectStmt') {
    throw new SqlValidationError('Only a single SELECT statement is allowed.', 'not_a_select');
  }

  const relations = new Set<string>();
  walk(stmt, relations);
  return { relations: [...relations] };
}

function walk(node: unknown, relations: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, relations);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }

  for (const key of Object.keys(node)) {
    if (FORBIDDEN_NODE_TYPES.has(key)) {
      throw new SqlValidationError(
        'Only read-only SELECT queries are permitted.',
        'forbidden_statement',
      );
    }

    const value = node[key];

    if (key === 'SelectStmt' && isRecord(value)) {
      if (value['intoClause'] !== null && value['intoClause'] !== undefined) {
        throw new SqlValidationError('SELECT INTO is not permitted.', 'select_into');
      }
      if (value['lockingClause'] !== null && value['lockingClause'] !== undefined) {
        throw new SqlValidationError('Locking clauses are not permitted.', 'locking_clause');
      }
    }

    if (key === 'RangeVar' && isRecord(value)) {
      const schema = typeof value['schemaname'] === 'string' ? value['schemaname'] : undefined;
      const relname = typeof value['relname'] === 'string' ? value['relname'] : '';
      if (!isAllowedRelation(schema, relname)) {
        throw new SqlValidationError(
          `Relation "${schema ?? ''}.${relname}" is not in the ${MCP_READ_SCHEMA} allowlist.`,
          'relation_not_allowlisted',
        );
      }
      relations.add(relname);
    }

    if (key === 'FuncCall' && isRecord(value)) {
      const name = funcCallName(value);
      const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
      if (FORBIDDEN_FUNCTIONS.has(name) || FORBIDDEN_FUNCTIONS.has(bare)) {
        throw new SqlValidationError(
          `Function "${name}" is not permitted.`,
          'forbidden_function',
        );
      }
    }

    walk(value, relations);
  }
}

/** Parse and validate raw SQL. Defaults to the real libpg_query parser. */
export async function validateSelect(
  sql: string,
  parseFn: ParseFn = parseSql,
): Promise<ValidatedSelect> {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    throw new SqlValidationError('Query must not be empty.', 'empty');
  }
  let parsed: unknown;
  try {
    parsed = await parseFn(trimmed);
  } catch {
    // Never leak parser internals; a parse failure is a rejected query.
    throw new SqlValidationError('Query could not be parsed.', 'unparsable');
  }
  return validateParsedSelect(parsed);
}
