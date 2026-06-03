import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';

/**
 * Binds an `mcp_read` data view (per mode) to the domain permission required to
 * touch it. Consumed by the DB MCP server / tool gateway to gate free-query
 * access per view. Admin-editable; unknown view fails closed.
 */
@Entity({ name: 'view_permissions' })
export class ViewPermission extends TimestampedEntity {
  @PrimaryColumn({ name: 'view_name', type: 'varchar', length: 100 })
  viewName!: string;

  /** 'read' | 'write'. */
  @PrimaryColumn({ name: 'mode', type: 'varchar', length: 10 })
  mode!: string;

  @Column({ name: 'permission_name', type: 'varchar', length: 100 })
  permissionName!: string;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;
}
