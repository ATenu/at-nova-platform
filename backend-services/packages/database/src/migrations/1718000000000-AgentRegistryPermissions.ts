import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the A2A agent-registry administration permissions (`read-agents`,
 * `write-agents`) and grants them to the built-in `admin` role.
 *
 * Migrations run before the seed, and roles are populated only by the seed
 * (`seedRolesAndPermissions`). So:
 *
 * - Fresh installs: the `roles` table is still empty here, the `admin` grant is
 *   skipped (the `WHERE EXISTS` guard keeps the `role_permissions` FK satisfied),
 *   and the seed then upserts `PERMISSIONS` + `ROLE_PERMISSIONS` (which already
 *   include these two permissions and the admin grants).
 * - Already-provisioned databases: the `admin` role exists, so this brings them
 *   up to date without a reseed.
 *
 * Idempotent via `ON CONFLICT DO NOTHING`. The permissions are seeded
 * unconditionally so route-policy reconciliation can bind `admin.agents.*` (its
 * FK is to `permissions`, not `roles`) on the upgrade path too.
 */
export class AgentRegistryPermissions1718000000000 implements MigrationInterface {
  name = 'AgentRegistryPermissions1718000000000';

  private readonly upStatements: string[] = [
    `INSERT INTO "permissions" ("name", "description", "is_system")
     VALUES
       ('read-agents', 'View the A2A agent registry', true),
       ('write-agents', 'Onboard and manage A2A agents', true)
     ON CONFLICT ("name") DO NOTHING`,
    // Guarded by EXISTS so a fresh DB (roles seeded later) does not violate the
    // role_permissions -> roles FK; the seed grants admin on fresh installs.
    `INSERT INTO "role_permissions" ("role_name", "permission_name")
     SELECT 'admin', perm
     FROM (VALUES ('read-agents'), ('write-agents')) AS v(perm)
     WHERE EXISTS (SELECT 1 FROM "roles" WHERE "name" = 'admin')
     ON CONFLICT ("role_name", "permission_name") DO NOTHING`,
  ];

  private readonly downStatements: string[] = [
    `DELETE FROM "role_permissions" WHERE "permission_name" IN ('read-agents', 'write-agents')`,
    `DELETE FROM "permissions" WHERE "name" IN ('read-agents', 'write-agents')`,
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
