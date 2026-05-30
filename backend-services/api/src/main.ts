import 'reflect-metadata';
import type { Server } from 'node:http';
import { AppDataSource } from '@nova/database';
import { createLogger } from '@nova/shared';
import { createApp } from './app';
import { loadApiConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({
    service: 'nova-api',
    level: config.logLevel,
    environment: config.environment,
  });

  const dataSource = await AppDataSource.initialize();
  logger.info('database connection established');

  const app = createApp({ config, logger, dataSource });
  const server: Server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'nova-api listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      dataSource
        .destroy()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet if config/DB failed; use console as a last resort.
  console.error('Failed to start nova-api:', error instanceof Error ? error.message : error);
  process.exit(1);
});
