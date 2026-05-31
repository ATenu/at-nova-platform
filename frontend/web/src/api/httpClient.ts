import { env } from '@/lib/env';
import { apiErrorFromResponse, networkError } from '@/lib/errors';
import { getAuthToken, notifyUnauthorized } from '@/auth/tokenBridge';

/**
 * Single typed HTTP client for the whole app. Centralizes base URL, bearer
 * token injection (with refresh handled by the auth session), query-string
 * building, JSON (de)serialization, request correlation, and error
 * normalization. Feature code never calls `fetch` directly.
 */

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  readonly query?: QueryParams;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** Extra request headers (e.g. `Idempotency-Key`). Reserved headers win. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Skip attaching the bearer token (e.g. genuinely public endpoints). */
  readonly anonymous?: boolean;
}

function buildUrl(path: string, query?: QueryParams): string {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  if (!options.anonymous) {
    const token = await getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  let payload: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw networkError();
  }

  if (response.status === 401) {
    notifyUnauthorized();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    throw apiErrorFromResponse(response.status, data);
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
