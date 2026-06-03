import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';

/**
 * Per-route access policy. The set of route ids is discovered from code at boot
 * (each declared route registers a default), but which permission gates a route
 * is stored here and is admin-editable, so a newly authored permission can be
 * bound to an existing route without a redeploy. Unknown/missing rows fail
 * closed at the enforcement layer.
 */
@Entity({ name: 'route_policies' })
export class RoutePolicy extends TimestampedEntity {
  @PrimaryColumn({ name: 'route_id', type: 'varchar', length: 150 })
  routeId!: string;

  /** 'public' | 'authenticated' | 'permission'. */
  @Column({ name: 'kind', type: 'varchar', length: 20 })
  kind!: string;

  /** Required permission when kind = 'permission'; null otherwise. */
  @Column({ name: 'permission_name', type: 'varchar', length: 100, nullable: true })
  permissionName!: string | null;

  @Column({ name: 'audit', type: 'boolean', default: false })
  audit!: boolean;

  /** Built-in route declared by code; the row is reconciled on boot. */
  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;
}
