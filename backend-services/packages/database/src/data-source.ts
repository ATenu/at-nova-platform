import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';
import { loadDatabaseConfig, type DatabaseConfig } from './config';

/**
 * Build TypeORM options from validated configuration.
 *
 * Migrations and entities are passed as concrete classes rather than glob
 * paths so the same DataSource works identically under ts-node (development)
 * and compiled JS (production / containers), with no path resolution surprises.
 */
export function buildDataSourceOptions(config: DatabaseConfig): DataSourceOptions {
  const ssl = config.DB_SSL ? { rejectUnauthorized: false } : false;

  const base = {
    entities: [...ENTITIES],
    migrations: [...MIGRATIONS],
    migrationsTableName: 'nova_migrations',
    synchronize: false as const,
    logging: config.DB_LOGGING,
  };

  if (config.DATABASE_URL) {
    return { type: 'postgres', url: config.DATABASE_URL, ssl, ...base };
  }

  // Guaranteed by the config schema's refinement, re-checked to satisfy the type narrowing.
  if (!config.POSTGRES_HOST || !config.POSTGRES_USER || !config.POSTGRES_DB) {
    throw new Error('Database connection requires DATABASE_URL or POSTGRES_HOST/USER/DB.');
  }

  return {
    type: 'postgres',
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT ?? 5432,
    username: config.POSTGRES_USER,
    database: config.POSTGRES_DB,
    ssl,
    ...(config.POSTGRES_PASSWORD !== undefined ? { password: config.POSTGRES_PASSWORD } : {}),
    ...base,
  };
}

/**
 * Singleton DataSource used by the TypeORM CLI, seeds, and services.
 *
 * This must be the file's ONLY exported `DataSource` instance: the TypeORM CLI
 * (`-d dist/data-source.js`) rejects a module that exports more than one, so we
 * intentionally do not also re-export it as a default.
 */
export const AppDataSource = new DataSource(buildDataSourceOptions(loadDatabaseConfig()));
