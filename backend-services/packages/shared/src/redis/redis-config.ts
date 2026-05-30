import { z } from 'zod';

/**
 * A Redis connection URL. Provider-agnostic: the same shape targets a local
 * container, Azure Cache for Redis, ElastiCache, Upstash, or Redis Cloud by
 * only changing the value. `rediss://` selects TLS; `redis://` is plaintext and
 * must only be used over a trusted private network (e.g. a local Docker bridge).
 */
export const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
    message: 'must be a redis:// or rediss:// URL',
  });

/** Default Redis port used when a connection URL omits one. */
const DEFAULT_REDIS_PORT = 6379;

export interface RedisConnectionInfo {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  /** True when the URL uses the TLS scheme (`rediss://`). */
  readonly tls: boolean;
}

/**
 * Extract the non-secret connection coordinates from a Redis URL. The password,
 * if present in the URL, is intentionally never returned so callers cannot leak
 * it into logs.
 */
export function parseRedisUrl(url: string): RedisConnectionInfo {
  const parsed = new URL(url);
  return {
    url,
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_REDIS_PORT,
    tls: parsed.protocol === 'rediss:',
  };
}
