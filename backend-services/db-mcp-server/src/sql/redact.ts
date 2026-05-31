import { piiColumnNames } from '../data/views';

/**
 * Column redaction (sqlAnalystAgentPlan §3.2 step 6) — defense in depth on top
 * of the curated views. Any output column whose name matches a PII-classified
 * column in the `mcp_read` allowlist is masked before rows leave the process,
 * so a future view change that re-exposes PII cannot leak it through the
 * free-query surface.
 */
const REDACTED = '[redacted]' as const;

const PII_COLUMNS = piiColumnNames();

/** Mask PII-classified columns in result rows. Non-PII values pass through. */
export function redactRows(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  if (PII_COLUMNS.size === 0) {
    return rows.map((row) => ({ ...row }));
  }
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = PII_COLUMNS.has(key) && value !== null && value !== undefined ? REDACTED : value;
    }
    return next;
  });
}

/** Column names that will be masked in any result (advertised to the caller). */
export function redactedColumnNames(): readonly string[] {
  return [...PII_COLUMNS];
}
