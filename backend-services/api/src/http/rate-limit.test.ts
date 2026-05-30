import express, { type Express } from 'express';
import request from 'supertest';
import type { Logger, RedisConnection } from '@nova/shared';
import { createRateLimiter, type RateLimiterOptions } from './rate-limit';

function silentLogger(): Logger {
  const noop = (): void => {};
  const logger = {
    child: (): Logger => logger,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  } as unknown as Logger;
  return logger;
}

function unreachableRedis(): RedisConnection {
  return {
    client: {
      call: () => Promise.reject(new Error('redis unreachable')),
    } as unknown as RedisConnection['client'],
    namespace: 'cache',
    ping: async () => false,
    quit: async () => {},
  };
}

function appWith(options: RateLimiterOptions): Express {
  const app = express();
  app.use(createRateLimiter(options));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createRateLimiter', () => {
  it('returns 429 once the limit is exceeded with the in-memory fallback', async () => {
    const app = appWith({
      windowMs: 60_000,
      max: 2,
      failOpen: true,
      cacheRedis: null,
      logger: silentLogger(),
    });

    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
  });

  it('fails open (allows traffic) when the redis store is unreachable', async () => {
    const app = appWith({
      windowMs: 60_000,
      max: 1,
      failOpen: true,
      cacheRedis: unreachableRedis(),
      logger: silentLogger(),
    });

    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get('/')).status).toBe(200);
    }
  });

  it('fails closed (5xx) when the store is unreachable and failOpen is false', async () => {
    const app = appWith({
      windowMs: 60_000,
      max: 1,
      failOpen: false,
      cacheRedis: unreachableRedis(),
      logger: silentLogger(),
    });

    expect((await request(app).get('/')).status).toBeGreaterThanOrEqual(500);
  });
});
