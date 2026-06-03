import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the admin-editable ``requires_approval`` flag to capabilities.
 *
 * Fresh installs already receive this column from ``DynamicRbac1717800000000``
 * (updated in place before first deploy). Existing databases that applied the
 * earlier DynamicRbac revision need this follow-up migration; ``IF NOT EXISTS``
 * keeps both paths idempotent.
 */
export class CapabilityRequiresApproval1717900000000 implements MigrationInterface {
  name = 'CapabilityRequiresApproval1717900000000';

  private readonly upStatements: string[] = [
    `ALTER TABLE "capabilities" ADD COLUMN IF NOT EXISTS "requires_approval" boolean NOT NULL DEFAULT false`,
  ];

  private readonly downStatements: string[] = [
    `ALTER TABLE "capabilities" DROP COLUMN IF EXISTS "requires_approval"`,
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
