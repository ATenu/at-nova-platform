/**
 * Result-size clamps for `run_select_query` (sqlAnalystAgentPlan §3.2 step 4).
 *
 * The validated SELECT is wrapped in an outer `LIMIT` so the engine never
 * materializes more than `maxRows`, regardless of any inner LIMIT the user
 * wrote. Wrapping (rather than rewriting/deparsing the parse tree) avoids any
 * risk of altering query semantics. A trailing semicolon is stripped first; the
 * validator already guarantees a single statement, so there is nothing to stack.
 */
export function clampSelectToLimit(validatedSql: string, maxRows: number): string {
  const withoutTrailingSemicolon = validatedSql.trim().replace(/;\s*$/, '');
  // The subquery alias keeps this valid for any SELECT, including set ops.
  return `SELECT * FROM (${withoutTrailingSemicolon}) AS _mcp_capped LIMIT ${maxRows}`;
}

export interface RowCapResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly truncated: boolean;
}

/**
 * Enforce a byte budget on the serialized result. Rows are dropped from the end
 * until the JSON payload fits, so a single huge result can never blow the
 * response budget. `maxRows` is enforced separately by the SQL LIMIT.
 */
export function capResultBytes(
  rows: readonly Record<string, unknown>[],
  maxBytes: number,
): RowCapResult {
  let kept = rows;
  let truncated = false;
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(kept), 'utf8') > maxBytes) {
    kept = kept.slice(0, Math.ceil(kept.length / 2));
    truncated = true;
  }
  return { rows: kept, truncated };
}
