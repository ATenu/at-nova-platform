import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dynamic, DB-driven RBAC. Promotes the database to the authoritative source of
 * authorization policy: capabilities, route->permission bindings, and view
 * bindings become editable rows, roles/permissions gain `is_system` protection,
 * roles record their Keycloak realm-role id, every policy change is audited, and a
 * single-row revision marker drives cache invalidation and the registry ETag.
 */
export class DynamicRbac1717800000000 implements MigrationInterface {
  name = 'DynamicRbac1717800000000';

  private readonly upStatements: string[] = [
    // --- Protect built-ins / record Keycloak linkage -----------------------
    `ALTER TABLE "roles" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "roles" ADD COLUMN "keycloak_role_id" varchar(255)`,
    `ALTER TABLE "permissions" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false`,

    // --- Capability catalog ------------------------------------------------
    `CREATE TABLE "capabilities" (
      "id" varchar(150) NOT NULL,
      "kind" varchar(30) NOT NULL,
      "mode" varchar(10) NOT NULL,
      "risk" varchar(10) NOT NULL,
      "resource_scoped" boolean NOT NULL DEFAULT false,
      "delegated" boolean NOT NULL DEFAULT false,
      "enabled" boolean NOT NULL DEFAULT true,
      "requires_approval" boolean NOT NULL DEFAULT false,
      "is_system" boolean NOT NULL DEFAULT false,
      "description" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_capabilities" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_capabilities_kind" CHECK ("kind" IN ('agent-skill', 'mcp-tool')),
      CONSTRAINT "CHK_capabilities_mode" CHECK ("mode" IN ('read', 'write')),
      CONSTRAINT "CHK_capabilities_risk" CHECK ("risk" IN ('low', 'high'))
    )`,
    `CREATE TABLE "capability_permissions" (
      "capability_id" varchar(150) NOT NULL,
      "permission_name" varchar(100) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_capability_permissions" PRIMARY KEY ("capability_id", "permission_name")
    )`,

    // --- Route -> permission binding --------------------------------------
    `CREATE TABLE "route_policies" (
      "route_id" varchar(150) NOT NULL,
      "kind" varchar(20) NOT NULL,
      "permission_name" varchar(100),
      "audit" boolean NOT NULL DEFAULT false,
      "is_system" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_route_policies" PRIMARY KEY ("route_id"),
      CONSTRAINT "CHK_route_policies_kind" CHECK ("kind" IN ('public', 'authenticated', 'permission')),
      CONSTRAINT "CHK_route_policies_permission" CHECK (
        ("kind" = 'permission' AND "permission_name" IS NOT NULL)
        OR ("kind" <> 'permission' AND "permission_name" IS NULL)
      )
    )`,

    // --- Data view -> permission binding ----------------------------------
    `CREATE TABLE "view_permissions" (
      "view_name" varchar(100) NOT NULL,
      "mode" varchar(10) NOT NULL,
      "permission_name" varchar(100) NOT NULL,
      "is_system" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_view_permissions" PRIMARY KEY ("view_name", "mode"),
      CONSTRAINT "CHK_view_permissions_mode" CHECK ("mode" IN ('read', 'write'))
    )`,

    // --- Audit + revision --------------------------------------------------
    `CREATE TABLE "rbac_audit_log" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "actor_subject" varchar(255) NOT NULL,
      "actor_user_id" uuid,
      "action" varchar(80) NOT NULL,
      "target_type" varchar(40) NOT NULL,
      "target_id" varchar(200) NOT NULL,
      "details" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rbac_audit_log" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE "rbac_revision" (
      "id" smallint NOT NULL,
      "revision" bigint NOT NULL DEFAULT 1,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_rbac_revision" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_rbac_revision_singleton" CHECK ("id" = 1)
    )`,
    `INSERT INTO "rbac_revision" ("id", "revision") VALUES (1, 1)`,

    // --- Indexes -----------------------------------------------------------
    `CREATE INDEX "IDX_capability_permissions_permission_name" ON "capability_permissions" ("permission_name")`,
    `CREATE INDEX "IDX_route_policies_permission_name" ON "route_policies" ("permission_name")`,
    `CREATE INDEX "IDX_view_permissions_permission_name" ON "view_permissions" ("permission_name")`,
    `CREATE INDEX "IDX_rbac_audit_log_actor_subject" ON "rbac_audit_log" ("actor_subject")`,
    `CREATE INDEX "IDX_rbac_audit_log_created_at" ON "rbac_audit_log" ("created_at")`,

    // --- Foreign keys ------------------------------------------------------
    `ALTER TABLE "capability_permissions" ADD CONSTRAINT "FK_capability_permissions_capability_id" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE CASCADE`,
    `ALTER TABLE "capability_permissions" ADD CONSTRAINT "FK_capability_permissions_permission_name" FOREIGN KEY ("permission_name") REFERENCES "permissions"("name") ON DELETE CASCADE`,
    `ALTER TABLE "route_policies" ADD CONSTRAINT "FK_route_policies_permission_name" FOREIGN KEY ("permission_name") REFERENCES "permissions"("name") ON DELETE RESTRICT`,
    `ALTER TABLE "view_permissions" ADD CONSTRAINT "FK_view_permissions_permission_name" FOREIGN KEY ("permission_name") REFERENCES "permissions"("name") ON DELETE RESTRICT`,
  ];

  private readonly downStatements: string[] = [
    `DROP TABLE IF EXISTS "rbac_revision"`,
    `DROP TABLE IF EXISTS "rbac_audit_log"`,
    `DROP TABLE IF EXISTS "view_permissions"`,
    `DROP TABLE IF EXISTS "route_policies"`,
    `DROP TABLE IF EXISTS "capability_permissions"`,
    `DROP TABLE IF EXISTS "capabilities"`,
    `ALTER TABLE "permissions" DROP COLUMN IF EXISTS "is_system"`,
    `ALTER TABLE "roles" DROP COLUMN IF EXISTS "keycloak_role_id"`,
    `ALTER TABLE "roles" DROP COLUMN IF EXISTS "is_system"`,
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
