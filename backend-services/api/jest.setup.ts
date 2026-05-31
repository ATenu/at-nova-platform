/**
 * Unit tests import modules that pull `@nova/database`, which constructs
 * `AppDataSource` at module load and requires a valid connection config.
 * CI does not provide real Postgres env vars; a placeholder URL is enough
 * because these tests mock repositories and never open a connection.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://nova:nova@localhost:5432/nova_test';
}
