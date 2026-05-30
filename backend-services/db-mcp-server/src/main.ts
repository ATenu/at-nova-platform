import 'reflect-metadata';
import { AppDataSource } from '@nova/database';
import { createLogger } from '@nova/shared';
import { describeSchema } from './schema/describe-schema';

/**
 * Data-surfacer entrypoint.
 *
 * This scaffold initializes the shared DataSource and prints the surfaced
 * schema as JSON, proving the read-only data-surfacing core works end to end.
 * To turn this into an MCP server, wrap `describeSchema` and a small set of
 * read-only, parameterized query tools with an MCP SDK transport (see README).
 */
async function main(): Promise<void> {
  const logger = createLogger({
    service: 'nova-db-mcp-server',
    level: process.env.LOG_LEVEL ?? 'info',
    environment: process.env.NODE_ENV ?? 'development',
  });

  const dataSource = await AppDataSource.initialize();
  try {
    const schema = describeSchema(dataSource);
    logger.info({ tableCount: schema.length }, 'surfaced database schema');
    console.log(JSON.stringify(schema, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('nova-db-mcp-server failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
