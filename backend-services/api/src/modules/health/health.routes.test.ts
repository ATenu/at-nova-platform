import express, { type Express } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { RedisConnection } from '@nova/shared';
import { createHealthRouter, type HealthRouterDeps } from './health.routes';

function dataSource(up: boolean): DataSource {
  return {
    query: async () => {
      if (!up) {
        throw new Error('database down');
      }
      return [{ result: 1 }];
    },
  } as unknown as DataSource;
}

function cacheRedis(reachable: boolean): RedisConnection {
  return {
    client: {} as RedisConnection['client'],
    namespace: 'cache',
    ping: async () => reachable,
    quit: async () => {},
  };
}

function appWith(deps: HealthRouterDeps): Express {
  const app = express();
  app.use('/health', createHealthRouter(deps));
  return app;
}

describe('GET /health/ready', () => {
  it('returns 200 with cache up when both dependencies are healthy', async () => {
    const res = await request(appWith({ dataSource: dataSource(true), cacheRedis: cacheRedis(true) })).get(
      '/health/ready',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', cache: 'up' });
  });

  it('stays 200 but reports cache down when only redis is unreachable (non-fatal)', async () => {
    const res = await request(appWith({ dataSource: dataSource(true), cacheRedis: cacheRedis(false) })).get(
      '/health/ready',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', cache: 'down' });
  });

  it('returns 503 when the database is down (hard dependency)', async () => {
    const res = await request(appWith({ dataSource: dataSource(false), cacheRedis: cacheRedis(true) })).get(
      '/health/ready',
    );
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'unavailable', database: 'down' });
  });

  it('reports cache not_configured when no cache redis is wired', async () => {
    const res = await request(appWith({ dataSource: dataSource(true) })).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.cache).toBe('not_configured');
  });
});
