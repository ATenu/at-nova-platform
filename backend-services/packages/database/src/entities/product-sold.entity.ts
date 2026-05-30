import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Sale } from './sale.entity';
import { Product } from './product.entity';

/** Line item linking a sale to a product with a quantity (composite primary key). */
@Entity({ name: 'products_sold' })
export class ProductSold {
  @PrimaryColumn({ name: 'sale_id', type: 'uuid' })
  saleId!: string;

  @PrimaryColumn({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'quantity', type: 'integer' })
  quantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Sale, (sale) => sale.productsSold, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale!: Sale;

  @ManyToOne(() => Product, (product) => product.productsSold, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
