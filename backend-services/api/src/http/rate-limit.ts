import rateLimit, {
  type IncrementResponse,
  type Options as RateLimitOptions,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Logger, RedisConnection } from '@nova/shared';

const DEFAULT_WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly max: number;
  /** Allow requests through when the store is unreachable. */
  readonly failOpen: boolean;
  /** Shared cache connection; `null` falls back to an in-memory store. */
  readonly cacheRedis: RedisConnection | null;
  readonly logger: Logger;
}

/**
 * Wraps a rate-limit `Store` so transient backend failures (e.g. Redis
 * unavailable) do not turn into 5xx responses for every request. Rate limiting
 * is an availability control, not an authorization control, so failing open is
 * the safe default. Authorization (JWT + RBAC) is unaffected by this path.
 */
class FailOpenStore implements Store {
  private windowMs = DEFAULT_WINDOW_MS;

  constructor(
    private readonly inner: Store,
    private readonly logger: Logger,
  ) {}

  init(options: RateLimitOptions): void {
    this.windowMs = options.windowMs;
    this.inner.init?.(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.inner.increment(key);
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'rate-limit store unavailable; failing open',
      );
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.inner.decrement(key);
    } catch {
      // Fail open: a missed decrement cannot block traffic.
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.inner.resetKey(key);
    } catch {
      // Fail open.
    }
  }
}

/**
 * Build the global rate-limit middleware. Uses a Redis-backed store so limits
 * are shared and correct across multiple API replicas. When no cache Redis is
 * configured (local dev/test), falls back to the in-memory store, which is only
 * correct for a single instance.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimitRequestHandler {
  const { windowMs, max, failOpen, cacheRedis, logger } = options;
  const base = {
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  } as const;

  if (!cacheRedis) {
    logger.warn(
      'REDIS_CACHE_URL is not set: using an in-memory rate-limit store that is NOT shared across replicas.',
    );
    return rateLimit(base);
  }

  const redisStore = new RedisStore({
    prefix: 'rl:',
    // rate-limit-redis issues raw commands; ioredis `call` runs them. Keep the
    // typed boundary narrow rather than leaking `unknown` into the store.
    sendCommand: (command: string, ...args: string[]) =>
      cacheRedis.client.call(command, ...args) as Promise<number | string>,
  });

  const store: Store = failOpen ? new FailOpenStore(redisStore, logger) : redisStore;
  return rateLimit({ ...base, store });
}
