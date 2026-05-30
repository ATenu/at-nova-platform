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
import { Customer } from './customer.entity';
import { ProductSold } from './product-sold.entity';
import { CustomerIssue } from './customer-issue.entity';

@Entity({ name: 'sales' })
@Index('IDX_sales_customer_id', ['customerId'])
@Index('IDX_sales_date', ['date'])
@Index('IDX_sales_payment_received', ['paymentReceived'])
export class Sale extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'discount_applied', type: 'numeric', precision: 5, scale: 2, nullable: true })
  discountApplied!: string | null;

  @Column({ name: 'date', type: 'timestamptz' })
  date!: Date;

  @Column({ name: 'total_amount_receipt', type: 'numeric', precision: 12, scale: 2 })
  totalAmountReceipt!: string;

  @Column({ name: 'payment_received', type: 'boolean', default: false })
  paymentReceived!: boolean;

  @Column({ name: 'date_of_payment', type: 'timestamptz', nullable: true })
  dateOfPayment!: Date | null;

  @ManyToOne(() => Customer, (customer) => customer.sales, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @OneToMany(() => ProductSold, (productSold) => productSold.sale)
  productsSold!: ProductSold[];

  @OneToMany(() => CustomerIssue, (issue) => issue.sale)
  customerIssues!: CustomerIssue[];
}
