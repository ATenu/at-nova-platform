import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { authorize } from '../../auth/authorize';
import { defineRoutePolicy } from '../../auth/route-policy';
import { asyncHandler } from '../../http/async-handler';

const livenessPolicy = defineRoutePolicy({ routeId: 'health.live', public: true });
const readinessPolicy = defineRoutePolicy({ routeId: 'health.ready', public: true });

export interface HealthRouterDeps {
  readonly dataSource: DataSource;
}

/**
 * Liveness and readiness probes. Public by design and used by container
 * orchestration; they expose only coarse status, never internal details.
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
      try {
        await deps.dataSource.query('SELECT 1');
        res.json({ status: 'ok', database: 'up' });
      } catch {
        res.status(503).json({ status: 'unavailable', database: 'down' });
      }
    }),
  );

  return router;
}
