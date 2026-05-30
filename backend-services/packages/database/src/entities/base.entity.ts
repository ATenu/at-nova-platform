import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Common audit timestamps. `created_at` is set on insert; `updated_at` is
 * maintained by TypeORM on every save. Join tables that only need a creation
 * timestamp do not extend this base.
 */
export abstract class TimestampedEntity {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
