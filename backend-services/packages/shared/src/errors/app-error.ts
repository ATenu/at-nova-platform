/**
 * Typed domain/application errors shared across services.
 *
 * Errors are transport-agnostic: they carry a stable machine-readable `code`
 * and a `category`. Transport layers (e.g. the HTTP API) map the category to a
 * protocol-specific representation such as an RFC 7807 problem response. This
 * keeps error semantics reusable by the API and the future MCP server alike.
 */

export type ErrorCategory =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

export interface AppErrorOptions {
  readonly code: string;
  readonly category: ErrorCategory;
  /** Safe, client-facing detail. Never include secrets, PII, or internals. */
  readonly detail?: string;
  /** Optional underlying cause, retained for logging only (never serialized). */
  readonly cause?: unknown;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly detail: string | undefined;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;
    this.detail = options.detail;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, code = 'validation_failed') {
    super('Request validation failed', { code, category: 'validation', detail });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(detail = 'Authentication is required.', code = 'unauthenticated') {
    super('Authentication required', { code, category: 'unauthenticated', detail });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have access to this resource.', code = 'forbidden') {
    super('Access denied', { code, category: 'forbidden', detail });
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'The requested resource was not found.', code = 'not_found') {
    super('Resource not found', { code, category: 'not_found', detail });
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, code = 'conflict') {
    super('Resource conflict', { code, category: 'conflict', detail });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown, code = 'internal_error') {
    super('Internal server error', { code, category: 'internal', cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
