import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { Sale } from './sale.entity';

@Entity({ name: 'customers' })
export class Customer extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_customers_email', { unique: true })
  @Column({ name: 'email', type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 511 })
  fullName!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 255 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 255 })
  lastName!: string;

  @Column({ name: 'age', type: 'integer', nullable: true })
  age!: number | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @OneToMany(() => Sale, (sale) => sale.customer)
  sales!: Sale[];
}
