/**
 * Typed errors for the DB MCP server. Messages are SAFE to return to the
 * caller: they never echo SQL, parameters, rows, connection strings, or other
 * PII/secrets. A numeric `code` lets tool handlers map to a stable reason
 * without leaking internals.
 */
export type McpErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_request'
  | 'sql_rejected'
  | 'upstream_unavailable'
  | 'internal';

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** Map any thrown value to a safe, caller-facing message + code. */
export function toSafeError(error: unknown): { code: McpErrorCode; message: string } {
  if (error instanceof McpError) {
    return { code: error.code, message: error.message };
  }
  // Never surface raw internal error text to the caller.
  return { code: 'internal', message: 'The request could not be completed.' };
}
