import type { RedisConnection } from './redis-client';

/**
 * A minimal, typed cache over a Redis connection. JSON-serialized values with
 * optional TTL. This is the shared extension point for future caching needs
 * (e.g. token-verification results, expensive lookups, idempotency keys); the
 * surface is deliberately small and grows only when a real consumer needs it.
 */
export interface CacheClient {
  /** Returns the parsed value, or `null` when the key is absent. */
  get<T>(key: string): Promise<T | null>;
  /** Store a JSON-serializable value with an optional TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Delete a key; a no-op when absent. */
  del(key: string): Promise<void>;
}

export function createCacheClient(connection: RedisConnection): CacheClient {
  const { client } = connection;
  return {
    async get<T>(key: string): Promise<T | null> {
      const raw = await client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      const raw = JSON.stringify(value);
      if (ttlSeconds === undefined) {
        await client.set(key, raw);
      } else {
        await client.set(key, raw, 'EX', ttlSeconds);
      }
    },
    async del(key: string): Promise<void> {
      await client.del(key);
    },
  };
}
