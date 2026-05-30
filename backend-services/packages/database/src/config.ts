import { booleanFromEnv, loadConfig } from '@nova/shared';
import { z } from 'zod';

/**
 * Database connection configuration, resolved once from the environment.
 * `DATABASE_URL` takes precedence; otherwise the individual POSTGRES_* values
 * are used. SSL is enabled only when explicitly requested.
 */
const databaseEnvSchema = z
  .object({
    DATABASE_URL: z.string().url().optional(),
    POSTGRES_HOST: z.string().min(1).optional(),
    POSTGRES_PORT: z.coerce.number().int().positive().optional(),
    POSTGRES_USER: z.string().min(1).optional(),
    POSTGRES_PASSWORD: z.string().optional(),
    POSTGRES_DB: z.string().min(1).optional(),
    DB_SSL: booleanFromEnv.default('false'),
    DB_LOGGING: booleanFromEnv.default('false'),
  })
  .refine(
    (env) =>
      Boolean(env.DATABASE_URL) ||
      Boolean(env.POSTGRES_HOST && env.POSTGRES_USER && env.POSTGRES_DB),
    {
      message:
        'Provide DATABASE_URL, or POSTGRES_HOST + POSTGRES_USER + POSTGRES_DB for the database connection.',
    },
  );

export type DatabaseConfig = z.infer<typeof databaseEnvSchema>;

export function loadDatabaseConfig(): DatabaseConfig {
  return loadConfig(databaseEnvSchema);
}
