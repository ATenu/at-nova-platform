import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Database isolation for the DB MCP server (sqlAnalystAgentPlan §3.1).
 *
 * Provisions a hardened, read-only surface over the business `nova` database so
 * the `at-sql-analyser` agent can free-query data WITHOUT ever touching base
 * tables or PII it is not entitled to:
 *
 *  - schema `mcp_read` holding a REVIEWED ALLOWLIST of curated views. The view
 *    set is a security boundary: PII columns (emails, ages, free-text issue /
 *    action descriptions, prompts/messages, auth internals) are excluded or
 *    masked. Changing it is a security-sensitive change (decision D6).
 *  - role `nova_mcp_readonly` (`LOGIN NOSUPERUSER NOCREATEDB NOINHERIT`): only
 *    `USAGE` on `mcp_read` and `SELECT` on its views — no grants on base tables,
 *    no usage of `public`. Views run with the view owner's privileges, so the
 *    role can never reach a base table directly.
 *  - per-role guards: `default_transaction_read_only = on`, `statement_timeout`,
 *    `idle_in_transaction_session_timeout`, `lock_timeout` — so even a bypassed
 *    application-layer check cannot write or hold the engine.
 *  - `security_barrier` views + a per-session GUC `nova.owner_subject` (set via
 *    `SET LOCAL` by the MCP server inside each query transaction). Owner-scoped
 *    views filter on it and FAIL CLOSED (no rows) when it is unset, so dynamic
 *    SQL cannot escape ownership scoping. Nova is single-tenant: the shared CRM
 *    views are gated by the `read-data` entitlement; `mcp_read.my_assigned_actions`
 *    demonstrates per-subject row scoping for owner-keyed data.
 *
 * The `nova_mcp_readonly` password is provisioned from `MCP_READONLY_DB_PASSWORD`
 * (never committed). The `db-init` job supplies it; the migration fails closed if
 * it is missing.
 */
export class McpReadDataSurface1717600000000 implements MigrationInterface {
  name = 'McpReadDataSurface1717600000000';

  private readonly upStatements: string[] = [
    `CREATE SCHEMA IF NOT EXISTS "mcp_read"`,

    // --- Curated, PII-aware views (the reviewed allowlist) ------------------
    // Customers: business display name only; email + age (PII) excluded.
    `CREATE OR REPLACE VIEW "mcp_read"."customers" WITH (security_barrier) AS
      SELECT "id", "full_name", "active", "created_at"
      FROM "public"."customers"`,

    // Products: catalog data, no PII.
    `CREATE OR REPLACE VIEW "mcp_read"."products" WITH (security_barrier) AS
      SELECT "id", "name", "description", "category", "price", "in_catalog", "created_at"
      FROM "public"."products"`,

    // Sales: financial facts, no direct PII.
    `CREATE OR REPLACE VIEW "mcp_read"."sales" WITH (security_barrier) AS
      SELECT "id", "customer_id", "discount_applied", "date", "total_amount_receipt",
             "payment_received", "date_of_payment", "created_at"
      FROM "public"."sales"`,

    // Line items.
    `CREATE OR REPLACE VIEW "mcp_read"."products_sold" WITH (security_barrier) AS
      SELECT "sale_id", "product_id", "quantity", "created_at"
      FROM "public"."products_sold"`,

    // Customer issues: status/timeline only; free-text `description` (PII risk)
    // excluded.
    `CREATE OR REPLACE VIEW "mcp_read"."customer_issues" WITH (security_barrier) AS
      SELECT "id", "sales_id", "date_raised", "date_last_update", "status", "created_at"
      FROM "public"."customer_issues"`,

    // Issue actions: title + status + ownership; free-text `description` excluded.
    `CREATE OR REPLACE VIEW "mcp_read"."issue_actions" WITH (security_barrier) AS
      SELECT "id", "issue_id", "title", "status", "updated_ai", "created_date", "assigned_owner_id"
      FROM "public"."issue_actions"`,

    // SOP metadata only; large `full_text` surfaced via the gated capability path.
    `CREATE OR REPLACE VIEW "mcp_read"."sops" WITH (security_barrier) AS
      SELECT "id", "name", "active", "created_at"
      FROM "public"."sops"`,
    `CREATE OR REPLACE VIEW "mcp_read"."sop_details" WITH (security_barrier) AS
      SELECT "sop_id", "version", "date_of_creation", "created_at"
      FROM "public"."sop_details"`,

    // Users: non-PII reference for joins (ownership). No email/names exposed.
    `CREATE OR REPLACE VIEW "mcp_read"."users" WITH (security_barrier) AS
      SELECT "id", "active", "created_at"
      FROM "public"."users"`,

    // Owner-scoped example: actions assigned to the acting subject only. Filters
    // on the per-session GUC and returns NO rows when it is unset (fail closed),
    // so dynamic SQL cannot escape the ownership predicate.
    `CREATE OR REPLACE VIEW "mcp_read"."my_assigned_actions" WITH (security_barrier) AS
      SELECT a."id", a."issue_id", a."title", a."status", a."created_date"
      FROM "public"."issue_actions" a
      JOIN "public"."users" u ON u."id" = a."assigned_owner_id"
      WHERE u."keycloak_id" IS NOT NULL
        AND u."keycloak_id"::text = current_setting('nova.owner_subject', true)`,

    // --- Read-only role -----------------------------------------------------
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nova_mcp_readonly') THEN
         CREATE ROLE "nova_mcp_readonly" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
       END IF;
     END
     $$`,
    `ALTER ROLE "nova_mcp_readonly" SET default_transaction_read_only = on`,
    `ALTER ROLE "nova_mcp_readonly" SET statement_timeout = '5s'`,
    `ALTER ROLE "nova_mcp_readonly" SET idle_in_transaction_session_timeout = '10s'`,
    `ALTER ROLE "nova_mcp_readonly" SET lock_timeout = '2s'`,

    // --- Least-privilege grants --------------------------------------------
    // No base-table access, no public usage; only the curated views.
    `REVOKE ALL ON SCHEMA "public" FROM "nova_mcp_readonly"`,
    `GRANT USAGE ON SCHEMA "mcp_read" TO "nova_mcp_readonly"`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA "mcp_read" TO "nova_mcp_readonly"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "mcp_read" GRANT SELECT ON TABLES TO "nova_mcp_readonly"`,
    `DO $$
     BEGIN
       EXECUTE format('GRANT CONNECT ON DATABASE %I TO "nova_mcp_readonly"', current_database());
     END
     $$`,
  ];

  private readonly downStatements: string[] = [
    `DROP VIEW IF EXISTS "mcp_read"."my_assigned_actions"`,
    `DROP VIEW IF EXISTS "mcp_read"."users"`,
    `DROP VIEW IF EXISTS "mcp_read"."sop_details"`,
    `DROP VIEW IF EXISTS "mcp_read"."sops"`,
    `DROP VIEW IF EXISTS "mcp_read"."issue_actions"`,
    `DROP VIEW IF EXISTS "mcp_read"."customer_issues"`,
    `DROP VIEW IF EXISTS "mcp_read"."products_sold"`,
    `DROP VIEW IF EXISTS "mcp_read"."sales"`,
    `DROP VIEW IF EXISTS "mcp_read"."products"`,
    `DROP VIEW IF EXISTS "mcp_read"."customers"`,
    `DROP SCHEMA IF EXISTS "mcp_read" CASCADE`,
    // DROP OWNED removes the role's grants/default-privilege entries so the role
    // can be dropped cleanly. The role owns no objects (views are owned by the
    // migration role).
    `DO $$
     BEGIN
       IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nova_mcp_readonly') THEN
         EXECUTE 'DROP OWNED BY "nova_mcp_readonly"';
         DROP ROLE "nova_mcp_readonly";
       END IF;
     END
     $$`,
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.upStatements) {
      await queryRunner.query(statement);
    }
    // Provision the role password from the environment (never committed). Use a
    // GUC + format(%L) so the literal is safely quoted (DDL cannot bind params).
    const password = process.env.MCP_READONLY_DB_PASSWORD;
    if (!password || password.trim().length === 0) {
      throw new Error(
        'MCP_READONLY_DB_PASSWORD is required to provision the nova_mcp_readonly role.',
      );
    }
    await queryRunner.query(`SELECT set_config('nova.mcp_provision_pw', $1, false)`, [password]);
    await queryRunner.query(
      `DO $$
       BEGIN
         EXECUTE format(
           'ALTER ROLE "nova_mcp_readonly" WITH LOGIN PASSWORD %L',
           current_setting('nova.mcp_provision_pw')
         );
       END
       $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.downStatements) {
      await queryRunner.query(statement);
    }
  }
}
