import { Router } from 'express';
import type { DataSource } from 'typeorm';
import type { RedisConnection } from '@nova/shared';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';

const livenessPolicy = defineRoutePolicy({ routeId: 'health.live', public: true });
const readinessPolicy = defineRoutePolicy({ routeId: 'health.ready', public: true });

export interface HealthRouterDeps {
  readonly dataSource: DataSource;
  /** Optional shared cache Redis; reported in readiness when configured. */
  readonly cacheRedis?: RedisConnection | null;
}

type CacheStatus = 'up' | 'down' | 'not_configured';

async function checkDatabase(dataSource: DataSource): Promise<boolean> {
  try {
    await dataSource.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function checkCache(cacheRedis: RedisConnection | null | undefined): Promise<CacheStatus> {
  if (!cacheRedis) {
    return 'not_configured';
  }
  return (await cacheRedis.ping()) ? 'up' : 'down';
}

/**
 * Liveness and readiness probes. Public by design and used by container
 * orchestration; they expose only coarse status, never internal details.
 *
 * Readiness fails (503) only when a hard dependency (the database) is down.
 * Cache Redis status is reported for observability but is non-fatal: the rate
 * limiter fails open, so a Redis blip must not pull every replica out of
 * rotation.
 */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/live', authorize(livenessPolicy), (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get(
    '/ready',
    authorize(readinessPolicy),
    asyncHandler(async (_req, res) => {
      const [databaseUp, cache] = await Promise.all([
        checkDatabase(deps.dataSource),
        checkCache(deps.cacheRedis),
      ]);

      res.status(databaseUp ? 200 : 503).json({
        status: databaseUp ? 'ok' : 'unavailable',
        database: databaseUp ? 'up' : 'down',
        cache,
      });
    }),
  );

  return router;
}
