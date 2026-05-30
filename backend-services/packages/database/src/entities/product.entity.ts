import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { ProductSold } from './product-sold.entity';

@Entity({ name: 'products' })
export class Product extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_products_name', { unique: true })
  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'category', type: 'varchar', length: 255 })
  category!: string;

  // Monetary value: stored as numeric in PostgreSQL, surfaced as string in TS
  // to avoid floating-point precision loss.
  @Column({ name: 'price', type: 'numeric', precision: 12, scale: 2 })
  price!: string;

  @Column({ name: 'in_catalog', type: 'boolean', default: true })
  inCatalog!: boolean;

  @OneToMany(() => ProductSold, (productSold) => productSold.product)
  productsSold!: ProductSold[];
}
