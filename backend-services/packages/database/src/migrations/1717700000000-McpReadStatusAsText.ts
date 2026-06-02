import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expose `status` as `text` (not the underlying enum) on the `mcp_read` views
 * that carry it.
 *
 * The SQL-analyst agent free-queries these curated views. When `status` is the
 * raw Postgres enum, a query that compares it against an out-of-domain literal
 * (e.g. `WHERE status = 'In Progress'`) fails closed with
 * `invalid input value for enum`, and the natural case-insensitive fallback
 * `LOWER(status)` errors with `function lower(<enum>) does not exist`. Casting
 * to `text` lets those comparisons execute (a bad value simply matches no rows)
 * and enables `LOWER()`/pattern matching, so the planner can self-correct
 * instead of looping on a hard failure.
 *
 * `CREATE OR REPLACE VIEW` cannot change an existing column's type, so each
 * affected view is dropped and recreated. The recreation preserves the
 * `security_barrier` property, column names/order, and (for
 * `my_assigned_actions`) the owner-scoping predicate. Rows are unaffected: an
 * enum already serializes to its label string, so `status` values are identical
 * — only the comparison semantics relax. SELECT is re-granted to
 * `nova_mcp_readonly` explicitly (idempotent; default privileges already cover
 * views created by this migration's owner role).
 */
export class McpReadStatusAsText1717700000000 implements MigrationInterface {
  name = 'McpReadStatusAsText1717700000000';

  private readonly upStatements: string[] = [
    `DROP VIEW IF EXISTS "mcp_read"."customer_issues"`,
    `CREATE VIEW "mcp_read"."customer_issues" WITH (security_barrier) AS
      SELECT "id", "sales_id", "date_raised", "date_last_update", "status"::text AS "status", "created_at"
      FROM "public"."customer_issues"`,
    `GRANT SELECT ON "mcp_read"."customer_issues" TO "nova_mcp_readonly"`,

    `DROP VIEW IF EXISTS "mcp_read"."issue_actions"`,
    `CREATE VIEW "mcp_read"."issue_actions" WITH (security_barrier) AS
      SELECT "id", "issue_id", "title", "status"::text AS "status", "updated_ai", "created_date", "assigned_owner_id"
      FROM "public"."issue_actions"`,
    `GRANT SELECT ON "mcp_read"."issue_actions" TO "nova_mcp_readonly"`,

    `DROP VIEW IF EXISTS "mcp_read"."my_assigned_actions"`,
    `CREATE VIEW "mcp_read"."my_assigned_actions" WITH (security_barrier) AS
      SELECT a."id", a."issue_id", a."title", a."status"::text AS "status", a."created_date"
      FROM "public"."issue_actions" a
      JOIN "public"."users" u ON u."id" = a."assigned_owner_id"
      WHERE u."keycloak_id" IS NOT NULL
        AND u."keycloak_id"::text = current_setting('nova.owner_subject', true)`,
    `GRANT SELECT ON "mcp_read"."my_assigned_actions" TO "nova_mcp_readonly"`,
  ];

  private readonly downStatements: string[] = [
    `DROP VIEW IF EXISTS "mcp_read"."customer_issues"`,
    `CREATE VIEW "mcp_read"."customer_issues" WITH (security_barrier) AS
      SELECT "id", "sales_id", "date_raised", "date_last_update", "status", "created_at"
      FROM "public"."customer_issues"`,
    `GRANT SELECT ON "mcp_read"."customer_issues" TO "nova_mcp_readonly"`,

    `DROP VIEW IF EXISTS "mcp_read"."issue_actions"`,
    `CREATE VIEW "mcp_read"."issue_actions" WITH (security_barrier) AS
      SELECT "id", "issue_id", "title", "status", "updated_ai", "created_date", "assigned_owner_id"
      FROM "public"."issue_actions"`,
    `GRANT SELECT ON "mcp_read"."issue_actions" TO "nova_mcp_readonly"`,

    `DROP VIEW IF EXISTS "mcp_read"."my_assigned_actions"`,
    `CREATE VIEW "mcp_read"."my_assigned_actions" WITH (security_barrier) AS
      SELECT a."id", a."issue_id", a."title", a."status", a."created_date"
      FROM "public"."issue_actions" a
      JOIN "public"."users" u ON u."id" = a."assigned_owner_id"
      WHERE u."keycloak_id" IS NOT NULL
        AND u."keycloak_id"::text = current_setting('nova.owner_subject', true)`,
    `GRANT SELECT ON "mcp_read"."my_assigned_actions" TO "nova_mcp_readonly"`,
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
