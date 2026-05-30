import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { CustomerIssueStatus, PG_ENUM_TYPES } from '../enums';
import { Sale } from './sale.entity';
import { IssueAction } from './issue-action.entity';

@Entity({ name: 'customer_issues' })
@Index('IDX_customer_issues_sales_id', ['salesId'])
@Index('IDX_customer_issues_status', ['status'])
@Index('IDX_customer_issues_date_raised', ['dateRaised'])
export class CustomerIssue extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sales_id', type: 'uuid' })
  salesId!: string;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @Column({ name: 'date_raised', type: 'timestamptz' })
  dateRaised!: Date;

  @Column({ name: 'date_last_update', type: 'timestamptz' })
  dateLastUpdate!: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: CustomerIssueStatus,
    enumName: PG_ENUM_TYPES.customerIssueStatus,
  })
  status!: CustomerIssueStatus;

  @ManyToOne(() => Sale, (sale) => sale.customerIssues, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sales_id' })
  sale!: Sale;

  @OneToMany(() => IssueAction, (action) => action.issue)
  issueActions!: IssueAction[];
}
