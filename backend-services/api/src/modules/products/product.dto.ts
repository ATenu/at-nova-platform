import type { Product } from '@nova/database';

export interface ProductDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly price: string;
  readonly inCatalog: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    inCatalog: product.inCatalog,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
