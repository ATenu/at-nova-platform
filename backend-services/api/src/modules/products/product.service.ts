import { NotFoundError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import { toProductDto, type ProductDto } from './product.dto';
import type { ProductListFilter, ProductRepository } from './product.repository';

export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  async listProducts(filter: ProductListFilter): Promise<PaginatedResult<ProductDto>> {
    const { items, total } = await this.repository.findPaginated(filter);
    return buildPaginatedResult(items.map(toProductDto), total, filter);
  }

  async getProductById(id: string): Promise<ProductDto> {
    const product = await this.repository.findById(id);
    if (!product) {
      throw new NotFoundError('Product not found.');
    }
    return toProductDto(product);
  }
}
