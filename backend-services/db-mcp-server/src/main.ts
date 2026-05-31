import { ServiceTokenClient, createLogger } from '@nova/shared';
import { loadMcpConfig } from './config';
import { ResourceServer } from './auth/resource-server';
import { SnapshotClient } from './auth/snapshot-client';
import { ReadOnlyDataSource } from './data/readonly-datasource';
import { createMcpHttpApp } from './server';

/**
 * DB MCP server entrypoint. A production, spec-compliant MCP resource server
 * exposing the data layer as secure, read-only tools over curated `mcp_read`
 * views. Fails closed: it refuses to boot without valid configuration and the
 * outbound credential needed to verify entitlement snapshots.
 */
function main(): void {
  const config = loadMcpConfig();
  const logger = createLogger({
    service: 'nova-db-mcp-server',
    level: config.logLevel,
    environment: config.environment,
  });

  if (!config.controlPlane.clientSecret) {
    throw new Error('MCP_DATA_CLIENT_SECRET is required to fetch entitlement snapshots.');
  }

  const dataSource = new ReadOnlyDataSource(config.db);
  const resourceServer = new ResourceServer(config.auth);
  const tokens = new ServiceTokenClient({
    tokenUrl: config.controlPlane.tokenUrl,
    clientId: config.controlPlane.clientId,
    clientSecret: config.controlPlane.clientSecret,
    scope: config.controlPlane.audienceScope,
  });
  const snapshotClient = new SnapshotClient(tokens, {
    baseUrl: config.controlPlane.baseUrl,
    audienceScope: config.controlPlane.audienceScope,
  });

  const app = createMcpHttpApp({ config, logger, resourceServer, snapshotClient, dataSource });

  const httpServer = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'nova-db-mcp-server listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    httpServer.close(() => {
      void dataSource.close().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (error: unknown) {
  console.error('nova-db-mcp-server failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
}
