import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { Sop } from './sop.entity';
import { User } from './user.entity';

/** Versioned full text of a SOP (composite primary key of sop + version). */
@Entity({ name: 'sop_details' })
export class SopDetail extends TimestampedEntity {
  @PrimaryColumn({ name: 'sop_id', type: 'uuid' })
  sopId!: string;

  @PrimaryColumn({ name: 'version', type: 'integer' })
  version!: number;

  @Column({ name: 'full_text', type: 'text' })
  fullText!: string;

  @Column({ name: 'date_of_creation', type: 'timestamptz' })
  dateOfCreation!: Date;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => Sop, (sop) => sop.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sop_id' })
  sop!: Sop;

  @ManyToOne(() => User, (user) => user.createdSopDetails, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User;
}
