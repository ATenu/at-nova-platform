import 'reflect-metadata';
import type { Server } from 'node:http';
import type { DataSource } from 'typeorm';
import { AppDataSource, createAgentsDataSource } from '@nova/database';
import { createLogger, createRedisConnection, type RedisConnection } from '@nova/shared';
import { createApp } from './app';
import { loadApiConfig } from './config';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({
    service: 'nova-api',
    level: config.logLevel,
    environment: config.environment,
  });

  const dataSource = await AppDataSource.initialize();
  logger.info('database connection established');

  // Isolated orchestration-state DB. Initialized only when configured so the
  // API still boots without the orchestration plane.
  const agentsDataSource: DataSource | null = config.agents.databaseUrl
    ? await createAgentsDataSource().initialize()
    : null;
  if (agentsDataSource) {
    logger.info('agents database connection established');
  }

  const cacheRedis: RedisConnection | null = config.redis.cacheUrl
    ? createRedisConnection({
        url: config.redis.cacheUrl,
        namespace: 'cache',
        keyPrefix: 'nova:',
        logger,
      })
    : null;

  const app = createApp({ config, logger, dataSource, cacheRedis, agentsDataSource });
  const server: Server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'nova-api listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Force exit if graceful drain stalls (e.g. a stuck connection), so the
    // orchestrator's rolling deploy is never blocked indefinitely.
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      void (async () => {
        try {
          if (cacheRedis) {
            await cacheRedis.quit();
          }
          if (agentsDataSource) {
            await agentsDataSource.destroy();
          }
          await dataSource.destroy();
          clearTimeout(forceExit);
          process.exit(0);
        } catch {
          process.exit(1);
        }
      })();
    });

    // Drop idle keep-alive sockets so `server.close` can resolve promptly while
    // in-flight requests are allowed to finish (until the force-exit deadline).
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet if config/DB failed; use console as a last resort.
  console.error('Failed to start nova-api:', error instanceof Error ? error.message : error);
  process.exit(1);
});
