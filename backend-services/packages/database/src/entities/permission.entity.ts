import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { RolePermission } from './role-permission.entity';

@Entity({ name: 'permissions' })
export class Permission extends TimestampedEntity {
  @PrimaryColumn({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  /** Built-in permission seeded by the platform; protected from deletion via the API. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @OneToMany(() => RolePermission, (rolePermission) => rolePermission.permission)
  rolePermissions!: RolePermission[];
}
