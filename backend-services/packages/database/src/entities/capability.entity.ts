import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { CapabilityPermission } from './capability-permission.entity';

/**
 * Agent/MCP capability catalog row. The set of capability ids is discovered from
 * running agent/tool code (only a registered handler can actually execute one),
 * but the authorization policy for each capability (its required permissions,
 * risk, and whether it is enabled) lives here and is admin-editable. A row that
 * no handler claims is inert (default deny).
 */
@Entity({ name: 'capabilities' })
export class Capability extends TimestampedEntity {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 150 })
  id!: string;

  /** 'agent-skill' | 'mcp-tool'. */
  @Column({ name: 'kind', type: 'varchar', length: 30 })
  kind!: string;

  /** 'read' | 'write'. */
  @Column({ name: 'mode', type: 'varchar', length: 10 })
  mode!: string;

  /** 'low' | 'high'. 'high' additionally requires a recorded human approval. */
  @Column({ name: 'risk', type: 'varchar', length: 10 })
  risk!: string;

  @Column({ name: 'resource_scoped', type: 'boolean', default: false })
  resourceScoped!: boolean;

  @Column({ name: 'delegated', type: 'boolean', default: false })
  delegated!: boolean;

  /** When false the capability is denied everywhere regardless of grants. */
  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  /**
   * When true the capability additionally requires a recorded human approval to
   * execute, on top of its required permissions. Admin-editable and DEFAULT
   * FALSE: by default a capability whose required permissions are granted is
   * allowed regardless of `risk` (which is informational metadata). Approval is
   * an explicit, opt-in control an admin can turn on per capability.
   */
  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval!: boolean;

  /** Built-in catalog entry; protected from deletion via the API. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => CapabilityPermission, (link) => link.capability)
  requiredPermissions!: CapabilityPermission[];
}
