import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Capability } from './capability.entity';
import { Permission } from './permission.entity';

/**
 * Join table binding a capability to a required permission. Authorization is
 * AND-composed: a capability is invokable only when the acting user's permission
 * set contains EVERY linked permission (default deny).
 */
@Entity({ name: 'capability_permissions' })
export class CapabilityPermission {
  @PrimaryColumn({ name: 'capability_id', type: 'varchar', length: 150 })
  capabilityId!: string;

  @PrimaryColumn({ name: 'permission_name', type: 'varchar', length: 100 })
  permissionName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Capability, (capability) => capability.requiredPermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'capability_id' })
  capability!: Capability;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_name' })
  permission!: Permission;
}
