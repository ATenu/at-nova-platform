import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live agent sub-events + full-fidelity webhook firehose
 * (`design-planning/agent-run-live-events-and-trace-resilience.md`).
 *
 * - `agent_run_events.dedupe_key`: nullable idempotency key for agent sub-events
 *   so a streamed frame and its terminal-artifact twin (or a reconnect replay)
 *   never produce duplicate rows. Enforced by a UNIQUE partial index
 *   (`WHERE dedupe_key IS NOT NULL`); lifecycle events keep `NULL` and are
 *   emitted exactly once by the worker.
 * - A partial `(run_id, sequence)` index filtered to `visibility = 'user'` so the
 *   SSE tail read (`listUserEventsAfter`) stays an index range scan as streaming
 *   multiplies rows per run.
 * - `webhook_auth_configs.visibility_scope` / `event_type_allowlist` make the
 *   firehose opt-out granular (default = ALL visibilities, ALL types) instead of
 *   the old hard-coded `user`-only fan-out; `include_raw_payloads` is the
 *   entitlement-gated opt-in for literal SQL / raw rows (default OFF).
 */
export class LiveEventsAndWebhookFirehose1717700000000 implements MigrationInterface {
  name = 'LiveEventsAndWebhookFirehose1717700000000';

  private readonly upStatements: string[] = [
    `ALTER TABLE "agent_run_events" ADD COLUMN IF NOT EXISTS "dedupe_key" text`,
    `CREATE UNIQUE INDEX "UQ_agent_run_events_dedupe_key" ON "agent_run_events" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL`,
    `CREATE INDEX "IDX_agent_run_events_user_run_sequence" ON "agent_run_events" ("run_id", "sequence") WHERE "visibility" = 'user'`,

    `ALTER TABLE "webhook_auth_configs" ADD COLUMN IF NOT EXISTS "visibility_scope" jsonb NOT NULL DEFAULT '["user","internal","security"]'::jsonb`,
    `ALTER TABLE "webhook_auth_configs" ADD COLUMN IF NOT EXISTS "event_type_allowlist" jsonb`,
    `ALTER TABLE "webhook_auth_configs" ADD COLUMN IF NOT EXISTS "include_raw_payloads" boolean NOT NULL DEFAULT false`,
  ];

  private readonly downStatements: string[] = [
    `ALTER TABLE "webhook_auth_configs" DROP COLUMN IF EXISTS "include_raw_payloads"`,
    `ALTER TABLE "webhook_auth_configs" DROP COLUMN IF EXISTS "event_type_allowlist"`,
    `ALTER TABLE "webhook_auth_configs" DROP COLUMN IF EXISTS "visibility_scope"`,
    `DROP INDEX IF EXISTS "IDX_agent_run_events_user_run_sequence"`,
    `DROP INDEX IF EXISTS "UQ_agent_run_events_dedupe_key"`,
    `ALTER TABLE "agent_run_events" DROP COLUMN IF EXISTS "dedupe_key"`,
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
