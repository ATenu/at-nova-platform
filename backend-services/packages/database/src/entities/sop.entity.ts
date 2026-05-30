import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { SopDetail } from './sop-detail.entity';

/** Standard Operating Procedure. Body text is versioned via `sop_details`. */
@Entity({ name: 'sops' })
export class Sop extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_sops_name', { unique: true })
  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @OneToMany(() => SopDetail, (detail) => detail.sop)
  details!: SopDetail[];
}
