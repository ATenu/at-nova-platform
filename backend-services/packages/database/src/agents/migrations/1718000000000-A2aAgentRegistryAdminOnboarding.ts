import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin-driven A2A onboarding: extend `a2a_agent_registrations` so the registry
 * can hold operator-onboarded agents alongside self-registered ones.
 *
 * Purely additive (nullable / defaulted columns), so existing self-registration
 * is untouched: pre-existing rows default to `source='self'`,
 * `status='onboarded'`, `enabled=true` and remain TTL-gated + routable exactly
 * as before. Admin-source rows are durable (included while enabled + onboarded
 * regardless of the heartbeat TTL) and carry onboarding attribution + the
 * server-side synthetic-heartbeat bookkeeping (`last_card_fetch_at`,
 * `last_error`). The card remains discovery data only; authorization stays with
 * the per-run snapshot, the shared catalog, and the Layer B gate.
 */
export class A2aAgentRegistryAdminOnboarding1718000000000 implements MigrationInterface {
  name = 'A2aAgentRegistryAdminOnboarding1718000000000';

  private readonly upStatements: string[] = [
    `ALTER TABLE "a2a_agent_registrations"
      ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'self',
      ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'onboarded',
      ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "display_name" text,
      ADD COLUMN IF NOT EXISTS "description" text,
      ADD COLUMN IF NOT EXISTS "version" text,
      ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "onboarded_by" text,
      ADD COLUMN IF NOT EXISTS "onboarded_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "last_card_fetch_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_error" text`,
    `ALTER TABLE "a2a_agent_registrations"
      ADD CONSTRAINT "CHK_a2a_source" CHECK ("source" IN ('self','admin'))`,
    `ALTER TABLE "a2a_agent_registrations"
      ADD CONSTRAINT "CHK_a2a_status" CHECK ("status" IN ('onboarded','unreachable','disabled','failed'))`,
    `CREATE INDEX "IDX_a2a_agent_registrations_source" ON "a2a_agent_registrations" ("source")`,
  ];

  private readonly downStatements: string[] = [
    `DROP INDEX IF EXISTS "IDX_a2a_agent_registrations_source"`,
    `ALTER TABLE "a2a_agent_registrations" DROP CONSTRAINT IF EXISTS "CHK_a2a_status"`,
    `ALTER TABLE "a2a_agent_registrations" DROP CONSTRAINT IF EXISTS "CHK_a2a_source"`,
    `ALTER TABLE "a2a_agent_registrations"
      DROP COLUMN IF EXISTS "last_error",
      DROP COLUMN IF EXISTS "consecutive_failures",
      DROP COLUMN IF EXISTS "last_card_fetch_at",
      DROP COLUMN IF EXISTS "onboarded_at",
      DROP COLUMN IF EXISTS "onboarded_by",
      DROP COLUMN IF EXISTS "tags",
      DROP COLUMN IF EXISTS "version",
      DROP COLUMN IF EXISTS "description",
      DROP COLUMN IF EXISTS "display_name",
      DROP COLUMN IF EXISTS "enabled",
      DROP COLUMN IF EXISTS "status",
      DROP COLUMN IF EXISTS "source"`,
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.upStatements) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.downStatements) {
      await queryRunner.query(statement);
    }
  }
}
