/**
 * Typed API error and normalization helpers. The backend returns an RFC
 * 7807-style `application/problem+json` body; we normalize both that shape and
 * arbitrary thrown values into a single `ApiError` so UI code never has to
 * inspect `unknown`. We never surface tokens, stack traces, or internal detail.
 */

/**
 * Normalized API error thrown by the HTTP client. Extends `Error` so it can be
 * thrown idiomatically, caught with `instanceof`, and surfaced by TanStack Query.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    correlationId?: string | undefined;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    if (init.correlationId !== undefined) {
      this.correlationId = init.correlationId;
    }
    if (init.details !== undefined) {
      this.details = init.details;
    }
  }
}

interface ProblemResponse {
  readonly title?: unknown;
  readonly detail?: unknown;
  readonly code?: unknown;
  readonly status?: unknown;
  readonly correlationId?: unknown;
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Build an ApiError from an HTTP status and a parsed response body. */
export function apiErrorFromResponse(status: number, body: unknown): ApiError {
  const problem = (typeof body === 'object' && body !== null ? body : {}) as ProblemResponse;
  return new ApiError({
    status,
    code: asString(problem.code) ?? `http_${status}`,
    message: asString(problem.detail) ?? asString(problem.title) ?? defaultMessage(status),
    correlationId: asString(problem.correlationId),
  });
}

export function networkError(message = 'Unable to reach the server. Check your connection.'): ApiError {
  return new ApiError({ status: 0, code: 'network_error', message });
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return 'The request could not be completed.';
}

/** Extract a safe, user-facing message from any thrown value. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}
