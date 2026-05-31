import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { AGENT_ENTITIES } from './entities';
import { AGENT_MIGRATIONS } from './migrations';
import { loadAgentsDatabaseConfig, type AgentsDatabaseConfig } from './agents-config';

/**
 * Build TypeORM options for the isolated agents DataSource. Entities and
 * migrations are concrete classes (not glob paths) so the same DataSource works
 * under ts-node and compiled JS. The migrations table is namespaced so it never
 * collides with the business DB's `nova_migrations`.
 *
 * Note: this module intentionally does NOT construct a DataSource at import, so
 * importing `@nova/database` never requires AGENTS_DATABASE_URL. The CLI target
 * (`agents-cli-data-source.ts`) constructs one explicitly.
 */
export function buildAgentsDataSourceOptions(config: AgentsDatabaseConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.AGENTS_DATABASE_URL,
    ssl: config.AGENTS_DB_SSL ? { rejectUnauthorized: false } : false,
    entities: [...AGENT_ENTITIES],
    migrations: [...AGENT_MIGRATIONS],
    migrationsTableName: 'nova_agents_migrations',
    synchronize: false,
    logging: config.DB_LOGGING,
  };
}

/** Create (but do not initialize) the agents DataSource from validated env. */
export function createAgentsDataSource(config = loadAgentsDatabaseConfig()): DataSource {
  return new DataSource(buildAgentsDataSourceOptions(config));
}
