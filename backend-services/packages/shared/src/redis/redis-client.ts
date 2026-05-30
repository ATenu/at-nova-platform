import Redis, { type RedisOptions } from 'ioredis';
import type { Logger } from '../logger/logger';
import { parseRedisUrl } from './redis-config';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_RETRIES_PER_REQUEST = 3;
const RETRY_BASE_MS = 200;
const MAX_RETRY_DELAY_MS = 2_000;

export interface CreateRedisConnectionOptions {
  /** Provider-agnostic connection URL (`redis://` or `rediss://`). */
  readonly url: string;
  /** Logical name attached to logs (e.g. `cache`); never the secret URL. */
  readonly namespace: string;
  /** Shared logger; only host/port/namespace are logged, never the password. */
  readonly logger: Logger;
  /** Optional Redis key prefix applied to keyed commands (e.g. `nova:`). */
  readonly keyPrefix?: string;
  /** Defer connecting until the first command. Defaults to eager connect. */
  readonly lazyConnect?: boolean;
}

/**
 * A managed Redis connection. Wraps `ioredis` with a minimal, typed surface so
 * consumers depend on this contract rather than the raw client, while still
 * exposing `client` for libraries (e.g. the rate-limit store) that need it.
 */
export interface RedisConnection {
  readonly client: Redis;
  readonly namespace: string;
  /** Returns true when the server responds to PING; never throws. */
  ping(): Promise<boolean>;
  /** Gracefully close the connection; falls back to a hard disconnect. */
  quit(): Promise<void>;
}

/**
 * Create a production-grade Redis connection. TLS is enabled automatically for
 * `rediss://` URLs. Connection lifecycle events are logged with non-secret
 * coordinates only (host, port, namespace) so credentials never reach logs.
 */
export function createRedisConnection(options: CreateRedisConnectionOptions): RedisConnection {
  const { url, namespace, logger } = options;
  const info = parseRedisUrl(url);
  const log = logger.child({
    component: 'redis',
    namespace,
    host: info.host,
    port: info.port,
  });

  const redisOptions: RedisOptions = {
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * RETRY_BASE_MS, MAX_RETRY_DELAY_MS),
    ...(info.tls ? { tls: {} } : {}),
    ...(options.keyPrefix ? { keyPrefix: options.keyPrefix } : {}),
    ...(options.lazyConnect ? { lazyConnect: true } : {}),
  };

  const client = new Redis(url, redisOptions);

  client.on('ready', () => log.info('redis connection ready'));
  client.on('reconnecting', (delayMs: number) => log.warn({ delayMs }, 'redis reconnecting'));
  client.on('end', () => log.info('redis connection closed'));
  client.on('error', (error: Error) => {
    // Log only the message; never the connection object, which carries the URL.
    log.error({ err: error.message }, 'redis connection error');
  });

  return {
    client,
    namespace,
    async ping(): Promise<boolean> {
      try {
        return (await client.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    async quit(): Promise<void> {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}
