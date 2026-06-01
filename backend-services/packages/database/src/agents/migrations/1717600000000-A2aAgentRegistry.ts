import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Native A2A dynamic discovery: a durable registry of A2A agents that
 * self-register their Agent Card on startup (and refresh it via heartbeat).
 *
 * The orchestrator builds its routing table and LLM menu metadata from these
 * trusted cards, while the per-run entitlement snapshot + shared RBAC catalog +
 * Layer B gate remain the authorization backbone (the registry is discovery,
 * never authorization). Liveness is tracked by `last_seen_at`; the orchestrator
 * only considers rows refreshed within its configured TTL. Agents never hold DB
 * credentials - they write only through the authenticated orchestrator
 * registration endpoint (least privilege).
 */
export class A2aAgentRegistry1717600000000 implements MigrationInterface {
  name = 'A2aAgentRegistry1717600000000';

  private readonly upStatements: string[] = [
    `CREATE TABLE "a2a_agent_registrations" (
      "name" text NOT NULL,
      "base_url" text NOT NULL,
      "audience" text NOT NULL,
      "card" jsonb NOT NULL,
      "skill_ids" jsonb NOT NULL,
      "registered_at" timestamptz NOT NULL DEFAULT now(),
      "last_seen_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_a2a_agent_registrations" PRIMARY KEY ("name")
    )`,
    `CREATE INDEX "IDX_a2a_agent_registrations_last_seen_at" ON "a2a_agent_registrations" ("last_seen_at")`,
  ];

  private readonly downStatements: string[] = [
    `DROP TABLE IF EXISTS "a2a_agent_registrations"`,
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
