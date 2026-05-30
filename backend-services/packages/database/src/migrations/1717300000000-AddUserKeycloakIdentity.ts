import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link application users to their Keycloak identity and track activation.
 *
 * `keycloak_id` stores the Keycloak user id once a profile is provisioned or
 * reconciled (nullable until then; uniquely indexed when present). `active`
 * mirrors the account's enabled state for cheap listing without per-row calls
 * to Keycloak; the sync endpoint reconciles the authoritative state.
 */
export class AddUserKeycloakIdentity1717300000000 implements MigrationInterface {
  name = 'AddUserKeycloakIdentity1717300000000';

  private readonly upStatements: string[] = [
    `ALTER TABLE "users" ADD COLUMN "keycloak_id" uuid`,
    `ALTER TABLE "users" ADD COLUMN "active" boolean NOT NULL DEFAULT true`,
    `CREATE UNIQUE INDEX "UQ_users_keycloak_id" ON "users" ("keycloak_id") WHERE "keycloak_id" IS NOT NULL`,
  ];

  private readonly downStatements: string[] = [
    `DROP INDEX IF EXISTS "UQ_users_keycloak_id"`,
    `ALTER TABLE "users" DROP COLUMN IF EXISTS "active"`,
    `ALTER TABLE "users" DROP COLUMN IF EXISTS "keycloak_id"`,
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
