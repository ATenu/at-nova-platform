import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial Nova schema: enum types, all tables, primary keys, unique
 * constraints, foreign keys, indexes, and check constraints.
 *
 * UUID primary keys default to `gen_random_uuid()` (built into PostgreSQL 13+),
 * so no extension is required. Money is stored as `numeric`, never float.
 */
export class InitialNovaSchema1717200000000 implements MigrationInterface {
  name = 'InitialNovaSchema1717200000000';

  private readonly upStatements: string[] = [
    // --- Enum types --------------------------------------------------------
    `CREATE TYPE "customer_issue_status_enum" AS ENUM ('in_assistance', 'rejected', 'completed')`,
    `CREATE TYPE "issue_action_status_enum" AS ENUM ('pending', 'in_progress', 'completed', 'rejected')`,
    `CREATE TYPE "message_role_enum" AS ENUM ('system', 'user', 'assistant')`,

    // --- Tables ------------------------------------------------------------
    `CREATE TABLE "users" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "email" varchar(320) NOT NULL,
      "first_name" varchar(255) NOT NULL,
      "last_name" varchar(255) NOT NULL,
      "middle_name" varchar(255),
      "description" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_users" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "roles" (
      "name" varchar(100) NOT NULL,
      "description" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roles" PRIMARY KEY ("name")
    )`,
    `CREATE TABLE "permissions" (
      "name" varchar(100) NOT NULL,
      "description" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_permissions" PRIMARY KEY ("name")
    )`,
    `CREATE TABLE "user_roles" (
      "user_id" uuid NOT NULL,
      "role_name" varchar(100) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_name")
    )`,
    `CREATE TABLE "role_permissions" (
      "role_name" varchar(100) NOT NULL,
      "permission_name" varchar(100) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_name", "permission_name")
    )`,
    `CREATE TABLE "customers" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "email" varchar(320) NOT NULL,
      "full_name" varchar(511) NOT NULL,
      "first_name" varchar(255) NOT NULL,
      "last_name" varchar(255) NOT NULL,
      "age" integer,
      "active" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_customers" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_customers_age_positive" CHECK ("age" IS NULL OR "age" > 0)
    )`,
    `CREATE TABLE "products" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "name" varchar(255) NOT NULL,
      "description" text,
      "category" varchar(255) NOT NULL,
      "price" numeric(12,2) NOT NULL,
      "in_catalog" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_products" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_products_price_non_negative" CHECK ("price" >= 0)
    )`,
    `CREATE TABLE "sales" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL,
      "discount_applied" numeric(5,2),
      "date" timestamptz NOT NULL,
      "total_amount_receipt" numeric(12,2) NOT NULL,
      "payment_received" boolean NOT NULL DEFAULT false,
      "date_of_payment" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_sales" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_sales_discount_min" CHECK ("discount_applied" IS NULL OR "discount_applied" >= 0),
      CONSTRAINT "CHK_sales_discount_max" CHECK ("discount_applied" IS NULL OR "discount_applied" <= 100),
      CONSTRAINT "CHK_sales_total_non_negative" CHECK ("total_amount_receipt" >= 0)
    )`,
    `CREATE TABLE "products_sold" (
      "sale_id" uuid NOT NULL,
      "product_id" uuid NOT NULL,
      "quantity" integer NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_products_sold" PRIMARY KEY ("sale_id", "product_id"),
      CONSTRAINT "CHK_products_sold_quantity_positive" CHECK ("quantity" > 0)
    )`,
    `CREATE TABLE "customer_issues" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "sales_id" uuid NOT NULL,
      "description" text NOT NULL,
      "date_raised" timestamptz NOT NULL,
      "date_last_update" timestamptz NOT NULL,
      "status" "customer_issue_status_enum" NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_customer_issues" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "issue_actions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "issue_id" uuid NOT NULL,
      "title" varchar(255) NOT NULL,
      "description" text NOT NULL,
      "status" "issue_action_status_enum" NOT NULL,
      "updated_by_id" uuid,
      "updated_ai" boolean NOT NULL DEFAULT false,
      "created_date" timestamptz NOT NULL,
      "assigned_owner_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_issue_actions" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "issue_action_dependencies" (
      "action_id" uuid NOT NULL,
      "depends_on_action_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_issue_action_dependencies" PRIMARY KEY ("action_id", "depends_on_action_id"),
      CONSTRAINT "CHK_issue_action_dependencies_no_self" CHECK ("action_id" <> "depends_on_action_id")
    )`,
    `CREATE TABLE "action_comments" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "issue_action_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "comment" text NOT NULL,
      "datetime" timestamptz NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_action_comments" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "sops" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "name" varchar(255) NOT NULL,
      "active" boolean NOT NULL DEFAULT true,
      "description" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_sops" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "sop_details" (
      "sop_id" uuid NOT NULL,
      "version" integer NOT NULL,
      "full_text" text NOT NULL,
      "date_of_creation" timestamptz NOT NULL,
      "created_by_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_sop_details" PRIMARY KEY ("sop_id", "version"),
      CONSTRAINT "CHK_sop_details_version_positive" CHECK ("version" > 0)
    )`,
    `CREATE TABLE "conversations" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "created_date" timestamptz NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_conversations" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "messages" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "conversation_id" uuid NOT NULL,
      "role" "message_role_enum" NOT NULL,
      "text" text NOT NULL,
      "is_mcp_apps" boolean NOT NULL DEFAULT false,
      "mcp_app_link" varchar(2048),
      "mcp_active" boolean,
      "created_date" timestamptz NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_messages" PRIMARY KEY ("id")
    )`,

    // --- Unique indexes ----------------------------------------------------
    `CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email")`,
    `CREATE UNIQUE INDEX "UQ_customers_email" ON "customers" ("email")`,
    `CREATE UNIQUE INDEX "UQ_products_name" ON "products" ("name")`,
    `CREATE UNIQUE INDEX "UQ_sops_name" ON "sops" ("name")`,

    // --- Secondary indexes -------------------------------------------------
    `CREATE INDEX "IDX_sales_customer_id" ON "sales" ("customer_id")`,
    `CREATE INDEX "IDX_sales_date" ON "sales" ("date")`,
    `CREATE INDEX "IDX_sales_payment_received" ON "sales" ("payment_received")`,
    `CREATE INDEX "IDX_customer_issues_sales_id" ON "customer_issues" ("sales_id")`,
    `CREATE INDEX "IDX_customer_issues_status" ON "customer_issues" ("status")`,
    `CREATE INDEX "IDX_customer_issues_date_raised" ON "customer_issues" ("date_raised")`,
    `CREATE INDEX "IDX_issue_actions_issue_id" ON "issue_actions" ("issue_id")`,
    `CREATE INDEX "IDX_issue_actions_status" ON "issue_actions" ("status")`,
    `CREATE INDEX "IDX_issue_actions_assigned_owner_id" ON "issue_actions" ("assigned_owner_id")`,
    `CREATE INDEX "IDX_issue_actions_created_date" ON "issue_actions" ("created_date")`,
    `CREATE INDEX "IDX_action_comments_issue_action_id" ON "action_comments" ("issue_action_id")`,
    `CREATE INDEX "IDX_action_comments_user_id" ON "action_comments" ("user_id")`,
    `CREATE INDEX "IDX_action_comments_datetime" ON "action_comments" ("datetime")`,
    `CREATE INDEX "IDX_conversations_user_id" ON "conversations" ("user_id")`,
    `CREATE INDEX "IDX_conversations_created_date" ON "conversations" ("created_date")`,
    `CREATE INDEX "IDX_messages_conversation_id" ON "messages" ("conversation_id")`,
    `CREATE INDEX "IDX_messages_role" ON "messages" ("role")`,
    `CREATE INDEX "IDX_messages_created_date" ON "messages" ("created_date")`,

    // --- Foreign keys ------------------------------------------------------
    `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_role_name" FOREIGN KEY ("role_name") REFERENCES "roles"("name") ON DELETE RESTRICT`,
    `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_role_name" FOREIGN KEY ("role_name") REFERENCES "roles"("name") ON DELETE CASCADE`,
    `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_permission_name" FOREIGN KEY ("permission_name") REFERENCES "permissions"("name") ON DELETE CASCADE`,
    `ALTER TABLE "sales" ADD CONSTRAINT "FK_sales_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "products_sold" ADD CONSTRAINT "FK_products_sold_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE`,
    `ALTER TABLE "products_sold" ADD CONSTRAINT "FK_products_sold_product_id" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "customer_issues" ADD CONSTRAINT "FK_customer_issues_sales_id" FOREIGN KEY ("sales_id") REFERENCES "sales"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "issue_actions" ADD CONSTRAINT "FK_issue_actions_issue_id" FOREIGN KEY ("issue_id") REFERENCES "customer_issues"("id") ON DELETE CASCADE`,
    `ALTER TABLE "issue_actions" ADD CONSTRAINT "FK_issue_actions_assigned_owner_id" FOREIGN KEY ("assigned_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "issue_actions" ADD CONSTRAINT "FK_issue_actions_updated_by_id" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    `ALTER TABLE "issue_action_dependencies" ADD CONSTRAINT "FK_issue_action_dependencies_action_id" FOREIGN KEY ("action_id") REFERENCES "issue_actions"("id") ON DELETE CASCADE`,
    `ALTER TABLE "issue_action_dependencies" ADD CONSTRAINT "FK_issue_action_dependencies_depends_on_action_id" FOREIGN KEY ("depends_on_action_id") REFERENCES "issue_actions"("id") ON DELETE CASCADE`,
    `ALTER TABLE "action_comments" ADD CONSTRAINT "FK_action_comments_issue_action_id" FOREIGN KEY ("issue_action_id") REFERENCES "issue_actions"("id") ON DELETE CASCADE`,
    `ALTER TABLE "action_comments" ADD CONSTRAINT "FK_action_comments_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "sop_details" ADD CONSTRAINT "FK_sop_details_sop_id" FOREIGN KEY ("sop_id") REFERENCES "sops"("id") ON DELETE CASCADE`,
    `ALTER TABLE "sop_details" ADD CONSTRAINT "FK_sop_details_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT`,
    `ALTER TABLE "conversations" ADD CONSTRAINT "FK_conversations_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE`,
  ];

  // Reverse dependency order. Dropping tables also drops their FKs and indexes.
  private readonly downStatements: string[] = [
    `DROP TABLE IF EXISTS "messages"`,
    `DROP TABLE IF EXISTS "conversations"`,
    `DROP TABLE IF EXISTS "action_comments"`,
    `DROP TABLE IF EXISTS "issue_action_dependencies"`,
    `DROP TABLE IF EXISTS "issue_actions"`,
    `DROP TABLE IF EXISTS "customer_issues"`,
    `DROP TABLE IF EXISTS "products_sold"`,
    `DROP TABLE IF EXISTS "sales"`,
    `DROP TABLE IF EXISTS "sop_details"`,
    `DROP TABLE IF EXISTS "sops"`,
    `DROP TABLE IF EXISTS "role_permissions"`,
    `DROP TABLE IF EXISTS "user_roles"`,
    `DROP TABLE IF EXISTS "permissions"`,
    `DROP TABLE IF EXISTS "roles"`,
    `DROP TABLE IF EXISTS "products"`,
    `DROP TABLE IF EXISTS "customers"`,
    `DROP TABLE IF EXISTS "users"`,
    `DROP TYPE IF EXISTS "message_role_enum"`,
    `DROP TYPE IF EXISTS "issue_action_status_enum"`,
    `DROP TYPE IF EXISTS "customer_issue_status_enum"`,
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
