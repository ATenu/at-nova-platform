import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial orchestration-plane schema for the isolated `postgres-agents`
 * database (section 6.2 of the Celery worker plan).
 *
 * Ownership is keyed by the Keycloak subject (`owner_subject`) plus the Nova
 * application user (`owner_user_id`); there is no tenant concept. `org_id` is
 * nullable-default scaffolding for future multi-tenancy and must never be
 * trusted from the client. Statuses/types/visibilities are stored as text so
 * the lifecycle can evolve without enum migrations. UUID primary keys default
 * to `gen_random_uuid()` (PostgreSQL 13+).
 */
export class InitialAgentsSchema1717400000000 implements MigrationInterface {
  name = 'InitialAgentsSchema1717400000000';

  private readonly upStatements: string[] = [
    `CREATE TABLE "agent_run_entitlements" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "owner_subject" text NOT NULL,
      "owner_user_id" uuid NOT NULL,
      "roles" jsonb NOT NULL,
      "permissions" jsonb NOT NULL,
      "capability_allowlist" jsonb NOT NULL,
      "snapshot_hash" text NOT NULL,
      "issued_at" timestamptz NOT NULL,
      "expires_at" timestamptz NOT NULL,
      CONSTRAINT "PK_agent_run_entitlements" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX "IDX_agent_run_entitlements_owner_subject" ON "agent_run_entitlements" ("owner_subject")`,

    `CREATE TABLE "agent_runs" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "owner_subject" text NOT NULL,
      "owner_user_id" uuid NOT NULL,
      "org_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
      "conversation_id" uuid,
      "status" text NOT NULL,
      "prompt_ref" text NOT NULL,
      "response_ref" text,
      "callback_auth_config_id" uuid,
      "entitlement_snapshot_id" uuid NOT NULL,
      "idempotency_key" text NOT NULL,
      "cancel_requested" boolean NOT NULL DEFAULT false,
      "last_heartbeat_at" timestamptz,
      "expires_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_agent_runs" PRIMARY KEY ("id"),
      CONSTRAINT "FK_agent_runs_entitlement" FOREIGN KEY ("entitlement_snapshot_id")
        REFERENCES "agent_run_entitlements" ("id") ON DELETE RESTRICT
    )`,
    `CREATE INDEX "IDX_agent_runs_owner_subject" ON "agent_runs" ("owner_subject")`,
    `CREATE INDEX "IDX_agent_runs_status" ON "agent_runs" ("status")`,
    `CREATE UNIQUE INDEX "UQ_agent_runs_owner_idempotency" ON "agent_runs" ("owner_subject", "idempotency_key")`,

    `CREATE TABLE "agent_run_events" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "run_id" uuid NOT NULL,
      "owner_subject" text NOT NULL,
      "sequence" bigint NOT NULL,
      "type" text NOT NULL,
      "payload" jsonb NOT NULL,
      "visibility" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_agent_run_events" PRIMARY KEY ("id"),
      CONSTRAINT "FK_agent_run_events_run" FOREIGN KEY ("run_id")
        REFERENCES "agent_runs" ("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "UQ_agent_run_events_run_sequence" ON "agent_run_events" ("run_id", "sequence")`,
    `CREATE INDEX "IDX_agent_run_events_owner_subject" ON "agent_run_events" ("owner_subject")`,

    `CREATE TABLE "agent_steps" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "run_id" uuid NOT NULL,
      "parent_step_id" uuid,
      "type" text NOT NULL,
      "status" text NOT NULL,
      "capability" text,
      "required_permission" text,
      "agent_name" text,
      "tool_name" text,
      "external_task_id" text,
      "input_ref" text,
      "output_ref" text,
      "started_at" timestamptz,
      "completed_at" timestamptz,
      "error_code" text,
      "error_message" text,
      CONSTRAINT "PK_agent_steps" PRIMARY KEY ("id"),
      CONSTRAINT "FK_agent_steps_run" FOREIGN KEY ("run_id")
        REFERENCES "agent_runs" ("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX "IDX_agent_steps_run_id" ON "agent_steps" ("run_id")`,

    `CREATE TABLE "agent_audit_log" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "run_id" uuid,
      "owner_subject" text,
      "actor" text NOT NULL,
      "action" text NOT NULL,
      "capability" text,
      "decision" text NOT NULL,
      "reason" text,
      "correlation_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_agent_audit_log" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX "IDX_agent_audit_log_run_id" ON "agent_audit_log" ("run_id")`,
    `CREATE INDEX "IDX_agent_audit_log_decision" ON "agent_audit_log" ("decision")`,
  ];

  private readonly downStatements: string[] = [
    `DROP TABLE IF EXISTS "agent_audit_log"`,
    `DROP TABLE IF EXISTS "agent_steps"`,
    `DROP TABLE IF EXISTS "agent_run_events"`,
    `DROP TABLE IF EXISTS "agent_runs"`,
    `DROP TABLE IF EXISTS "agent_run_entitlements"`,
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
