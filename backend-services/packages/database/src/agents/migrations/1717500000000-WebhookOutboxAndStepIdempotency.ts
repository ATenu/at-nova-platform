import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 (durable async execution): the webhook transactional outbox
 * (`webhook_deliveries`), per-owner webhook auth configuration
 * (`webhook_auth_configs`), and a step-level idempotency key so the worker can
 * detect an already-completed step on Celery retry / broker redelivery /
 * worker restart (section 8 idempotency keys, section 12 outbox).
 */
export class WebhookOutboxAndStepIdempotency1717500000000 implements MigrationInterface {
  name = 'WebhookOutboxAndStepIdempotency1717500000000';

  private readonly upStatements: string[] = [
    `CREATE TABLE "webhook_auth_configs" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "owner_subject" text NOT NULL,
      "auth_type" text NOT NULL,
      "token_secret_ref" text,
      "hmac_secret_ref" text,
      "jwks_url" text,
      "audience" text,
      "issuer" text,
      "destination_url" text NOT NULL,
      "active" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "rotated_at" timestamptz,
      CONSTRAINT "PK_webhook_auth_configs" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX "IDX_webhook_auth_configs_owner_subject" ON "webhook_auth_configs" ("owner_subject")`,

    `CREATE TABLE "webhook_deliveries" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "run_id" uuid NOT NULL,
      "event_id" uuid NOT NULL,
      "owner_subject" text NOT NULL,
      "destination_url" text NOT NULL,
      "auth_config_id" uuid,
      "status" text NOT NULL DEFAULT 'pending',
      "attempt_count" integer NOT NULL DEFAULT 0,
      "next_attempt_at" timestamptz,
      "last_error" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "delivered_at" timestamptz,
      CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id"),
      CONSTRAINT "FK_webhook_deliveries_run" FOREIGN KEY ("run_id")
        REFERENCES "agent_runs" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_webhook_deliveries_event" FOREIGN KEY ("event_id")
        REFERENCES "agent_run_events" ("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX "IDX_webhook_deliveries_run_id" ON "webhook_deliveries" ("run_id")`,
    `CREATE INDEX "IDX_webhook_deliveries_status_next_attempt" ON "webhook_deliveries" ("status", "next_attempt_at")`,
    `CREATE UNIQUE INDEX "UQ_webhook_deliveries_event_destination" ON "webhook_deliveries" ("event_id", "destination_url")`,

    `ALTER TABLE "agent_steps" ADD COLUMN IF NOT EXISTS "idempotency_key" text`,
    `CREATE UNIQUE INDEX "UQ_agent_steps_run_idempotency" ON "agent_steps" ("run_id", "idempotency_key")`,
  ];

  private readonly downStatements: string[] = [
    `DROP INDEX IF EXISTS "UQ_agent_steps_run_idempotency"`,
    `ALTER TABLE "agent_steps" DROP COLUMN IF EXISTS "idempotency_key"`,
    `DROP TABLE IF EXISTS "webhook_deliveries"`,
    `DROP TABLE IF EXISTS "webhook_auth_configs"`,
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
