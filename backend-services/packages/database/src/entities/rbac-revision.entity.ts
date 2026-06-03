import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Single-row monotonic revision marker bumped on every RBAC policy mutation.
 * Used as the cache-invalidation signal (paired with a Postgres NOTIFY) and as
 * the ETag for the public registry endpoint so the frontend and agents can cheaply
 * detect when their cached policy is stale.
 */
@Entity({ name: 'rbac_revision' })
export class RbacRevision {
  /** Always 1; the table holds exactly one row. */
  @PrimaryColumn({ name: 'id', type: 'smallint' })
  id!: number;

  @Column({ name: 'revision', type: 'bigint' })
  revision!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
