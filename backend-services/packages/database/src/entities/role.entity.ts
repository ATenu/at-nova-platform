import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { UserRole } from './user-role.entity';
import { RolePermission } from './role-permission.entity';

@Entity({ name: 'roles' })
export class Role extends TimestampedEntity {
  @PrimaryColumn({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  /** Built-in role seeded by the platform; protected from deletion via the API. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  /** Id of the matching Keycloak realm role, recorded once provisioned. */
  @Column({ name: 'keycloak_role_id', type: 'varchar', length: 255, nullable: true })
  keycloakRoleId!: string | null;

  @OneToMany(() => UserRole, (userRole) => userRole.role)
  userRoles!: UserRole[];

  @OneToMany(() => RolePermission, (rolePermission) => rolePermission.role)
  rolePermissions!: RolePermission[];
}
