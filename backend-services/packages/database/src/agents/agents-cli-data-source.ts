import { createAgentsDataSource } from './agents-data-source';

/**
 * Singleton agents DataSource used ONLY by the TypeORM CLI
 * (`-d src/agents/agents-cli-data-source.ts`). Constructed at import, so it
 * requires AGENTS_DATABASE_URL to be present — which the migration job provides.
 * Intentionally not re-exported from the package index, so importing
 * `@nova/database` elsewhere never forces AGENTS_DATABASE_URL.
 *
 * The CLI rejects a module exporting more than one DataSource, so this is the
 * file's only export.
 */
export const AgentsDataSource = createAgentsDataSource();
