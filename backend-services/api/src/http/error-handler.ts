import type { ErrorRequestHandler, Request } from 'express';
import { AppError, type ErrorCategory, InternalError, isAppError } from '@nova/shared';

/** RFC 7807-style problem response with stable machine-readable fields. */
export interface ApiErrorResponse {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly code: string;
  readonly correlationId: string;
}

const STATUS_BY_CATEGORY: Readonly<Record<ErrorCategory, number>> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

function correlationIdOf(req: Request): string {
  const id: unknown = req.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
}

/**
 * Single centralized error-handling middleware. Maps typed domain errors to a
 * consistent problem response and never leaks stack traces, ORM errors, or
 * internal details to clients. Unexpected errors are logged in full and
 * surfaced as a generic 500.
 */
export function createErrorHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const correlationId = correlationIdOf(req);
    const appError: AppError = isAppError(err) ? err : new InternalError(err);
    const status = STATUS_BY_CATEGORY[appError.category];

    if (appError.category === 'internal') {
      req.log?.error({ err, correlationId }, 'unhandled error');
    } else {
      req.log?.info(
        { code: appError.code, category: appError.category, correlationId },
        'request rejected',
      );
    }

    const body: ApiErrorResponse = {
      type: `https://errors.nova.platform/${appError.code}`,
      title: appError.message,
      status,
      code: appError.code,
      correlationId,
      ...(appError.detail !== undefined ? { detail: appError.detail } : {}),
    };

    res.status(status).type('application/problem+json').json(body);
  };
}
